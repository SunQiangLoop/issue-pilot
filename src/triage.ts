import {
  IssuePilotConfig,
  TriageResult,
  IssueContext,
  DuplicateMatch,
  LabelSuggestion,
} from './types.js';
import { getIssue, getRecentIssues, addLabels, addComment, assignIssue } from './github.js';
import { analyzeIssueWithUsage } from './ai.js';
import { findDuplicates } from './duplicate.js';

/**
 * Triage a single GitHub issue: fetch, analyze, detect duplicates, apply labels & comment.
 */
export async function triageIssue(
  config: IssuePilotConfig,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<TriageResult> {
  const startTime = Date.now();

  // 1. Fetch the issue from GitHub
  const issue = await getIssue(config.githubToken, owner, repo, issueNumber);

  // 2. Get recent issues for duplicate detection
  const recentIssues = await getRecentIssues(config.githubToken, owner, repo, 100);

  // 3. AI analysis with token usage tracking
  const { analysis, tokenUsage } = await analyzeIssueWithUsage(issue.title, issue.body, config);

  // 4. Find duplicates using hybrid similarity
  const duplicates = findDuplicates(
    issue,
    recentIssues,
    config.duplicateThreshold,
    analysis.duplicateKeywords
  );

  // 5. Determine labels to apply
  const confidenceThreshold = config.confidenceThreshold ?? 0.7;
  const labelsToApply = selectLabels(analysis.suggestedLabels, duplicates, analysis.severity, confidenceThreshold);
  const appliedLabels: string[] = [];
  const processingTimeMs = Date.now() - startTime;

  if (!config.dryRun) {
    if (labelsToApply.length > 0) {
      await addLabels(config.githubToken, owner, repo, issueNumber, labelsToApply);
      appliedLabels.push(...labelsToApply);
    }

    if (config.autoAssign && analysis.suggestedAssignees.length > 0) {
      await assignIssue(config.githubToken, owner, repo, issueNumber, analysis.suggestedAssignees);
    }

    const comment = buildTriageComment(issue, analysis, duplicates, labelsToApply, confidenceThreshold);
    await addComment(config.githubToken, owner, repo, issueNumber, comment);

    return {
      issue,
      analysis,
      duplicates,
      appliedLabels,
      commentPosted: true,
      dryRun: false,
      processingTimeMs,
      tokenUsage,
    };
  }

  return {
    issue,
    analysis,
    duplicates,
    appliedLabels: labelsToApply,
    commentPosted: false,
    dryRun: true,
    processingTimeMs,
    tokenUsage,
  };
}

/**
 * Triage all recent open issues in a repository with rate limiting.
 */
export async function triageAllIssues(
  config: IssuePilotConfig,
  owner: string,
  repo: string,
  limit = 20
): Promise<TriageResult[]> {
  const effectiveLimit = Math.min(limit, config.maxIssues ?? 50);
  const recentIssues = await getRecentIssues(config.githubToken, owner, repo, effectiveLimit);
  const results: TriageResult[] = [];

  for (const issue of recentIssues.slice(0, effectiveLimit)) {
    try {
      const result = await triageIssue(config, owner, repo, issue.number);
      results.push(result);

      // Respect GitHub's secondary rate limit
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Failed to triage issue #${issue.number}: ${error}`);
    }
  }

  return results;
}

/**
 * Select labels to apply based on AI suggestions, duplicates, and severity.
 */
function selectLabels(
  suggestedLabels: LabelSuggestion[],
  duplicates: DuplicateMatch[],
  severity: string,
  confidenceThreshold: number
): string[] {
  const labels = new Set<string>();

  for (const suggestion of suggestedLabels) {
    if (suggestion.confidence >= confidenceThreshold) {
      labels.add(suggestion.name);
    }
  }

  const severityLabel = getSeverityLabel(severity);
  if (severityLabel) {
    labels.add(severityLabel);
  }

  if (duplicates.length > 0) {
    labels.add('duplicate');
  }

  return Array.from(labels);
}

function getSeverityLabel(severity: string): string | null {
  const map: Record<string, string> = {
    low: 'low-priority',
    medium: 'medium-priority',
    high: 'high-priority',
    critical: 'critical',
  };
  return map[severity] ?? null;
}

/**
 * Build the markdown triage comment.
 */
function buildTriageComment(
  issue: IssueContext,
  analysis: {
    summary: string;
    issueType: string;
    severity: string;
    suggestedLabels: LabelSuggestion[];
    suggestedAssignees: string[];
    additionalContext: string;
  },
  duplicates: DuplicateMatch[],
  appliedLabels: string[],
  confidenceThreshold: number
): string {
  const typeEmoji: Record<string, string> = {
    bug: '🐛',
    feature: '✨',
    question: '❓',
    docs: '📚',
    security: '🔒',
    other: '📌',
  };

  const severityEmoji: Record<string, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
  };

  const issueTypeDisplay = `${typeEmoji[analysis.issueType] ?? '📌'} ${capitalize(analysis.issueType)}`;
  const severityDisplay = `${severityEmoji[analysis.severity] ?? '⚪'} ${capitalize(analysis.severity)}`;

  let comment = `## 🤖 Issue Pilot Triage Report

| Field | Value |
|-------|-------|
| **Type** | ${issueTypeDisplay} |
| **Severity** | ${severityDisplay} |
| **Summary** | ${analysis.summary} |

`;

  // Applied Labels section
  if (appliedLabels.length > 0) {
    comment += `### 📋 Applied Labels\n`;
    for (const labelName of appliedLabels) {
      const suggestion = analysis.suggestedLabels.find((s) => s.name === labelName);
      const reason = suggestion?.reason || getLabelDefaultReason(labelName, analysis);
      const confidence = suggestion ? ` *(${Math.round(suggestion.confidence * 100)}% confidence)*` : '';
      comment += `- \`${labelName}\` — ${reason}${confidence}\n`;
    }
    comment += '\n';
  } else {
    comment += `### 📋 Labels\nNo labels met the confidence threshold (${Math.round(confidenceThreshold * 100)}%) for automatic application.\n\n`;
  }

  // AI Label Suggestions below threshold (informational)
  const lowConfidenceSuggestions = analysis.suggestedLabels.filter(
    (s) => s.confidence < confidenceThreshold && !appliedLabels.includes(s.name)
  );
  if (lowConfidenceSuggestions.length > 0) {
    comment += `<details>\n<summary>💡 Additional label suggestions (below threshold)</summary>\n\n`;
    for (const s of lowConfidenceSuggestions) {
      comment += `- \`${s.name}\` — ${s.reason} *(${Math.round(s.confidence * 100)}% confidence)*\n`;
    }
    comment += `\n</details>\n\n`;
  }

  // Potential Duplicates section
  if (duplicates.length > 0) {
    comment += `### 🔍 Potential Duplicates\n`;
    comment += `This issue may be related to ${duplicates.length} existing issue${duplicates.length > 1 ? 's' : ''}:\n\n`;
    for (const dup of duplicates) {
      const pct = Math.round(dup.similarity * 100);
      const keywords = dup.matchedKeywords.length > 0
        ? ` — matched: \`${dup.matchedKeywords.join('`, `')}\``
        : '';
      comment += `- [#${dup.issueNumber}](${dup.url}) **${dup.title}** *(${pct}% similarity${keywords})*\n`;
    }
    comment += `\n> Please check if your issue is already covered. If it is a duplicate, close this issue and link to the original.\n\n`;
  }

  // Suggested Assignees section
  if (analysis.suggestedAssignees.length > 0) {
    comment += `### 👤 Suggested Assignees\n`;
    comment += analysis.suggestedAssignees.map((a) => `@${a}`).join(', ') + '\n\n';
  }

  // Next Steps section
  comment += `### ℹ️ Next Steps\n`;
  if (analysis.additionalContext) {
    comment += `${analysis.additionalContext}\n\n`;
  } else {
    comment += getDefaultNextSteps(analysis.issueType, duplicates.length > 0);
    comment += '\n\n';
  }

  comment += `---\n*Triaged by [Issue Pilot](https://github.com/sunqiang/issue-pilot) 🚀 — AI-powered issue triage for GitHub*`;

  return comment;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getLabelDefaultReason(
  labelName: string,
  analysis: { issueType: string; severity: string }
): string {
  const reasons: Record<string, string> = {
    'bug': 'Describes unexpected behavior or a defect',
    'feature': 'Requests new functionality or enhancement',
    'question': 'Seeks information or clarification',
    'docs': 'Related to documentation improvements',
    'security': 'Involves a security vulnerability or concern',
    'low-priority': 'Assessed as low severity with minimal user impact',
    'medium-priority': 'Assessed as medium severity with moderate user impact',
    'high-priority': 'Assessed as high severity requiring prompt attention',
    'critical': 'Critical issue requiring immediate attention',
    'duplicate': 'Likely duplicate of an existing open issue',
    'needs-info': 'Requires additional information to proceed',
    'good-first-issue': 'Suitable for new contributors',
    'help-wanted': 'Community help is welcome on this issue',
    'wontfix': 'This will not be worked on',
    'invalid': 'This issue is not valid or cannot be reproduced',
    'enhancement': 'Improvement to an existing feature',
  };
  return reasons[labelName] ?? `Applied based on ${analysis.issueType} classification`;
}

function getDefaultNextSteps(issueType: string, hasDuplicates: boolean): string {
  if (hasDuplicates) {
    return [
      '1. Review the potential duplicates listed above',
      '2. If this is indeed a duplicate, please close this issue and comment on the original',
      '3. If this is a distinct issue, provide additional context to differentiate it',
    ].join('\n');
  }

  const steps: Record<string, string> = {
    bug: [
      '1. Ensure steps to reproduce are clearly described',
      '2. Include environment details (OS, runtime version, browser, etc.)',
      '3. Attach any relevant logs, screenshots, or error messages',
      '4. A maintainer will review and prioritize this bug report',
    ].join('\n'),

    feature: [
      '1. Describe the problem this feature would solve (the "why")',
      '2. Share any implementation ideas or design sketches if you have them',
      '3. A maintainer will review feasibility and alignment with project goals',
    ].join('\n'),

    question: [
      '1. Check the documentation and existing issues/discussions first',
      '2. If not answered there, a maintainer will respond shortly',
      '3. Consider joining community discussions for faster responses',
    ].join('\n'),

    docs: [
      '1. Point to the specific page or section that needs updating',
      '2. Suggest the correct information if possible',
      '3. A maintainer will review and update the documentation',
    ].join('\n'),

    security: [
      '⚠️ **Security Notice**: If this is a sensitive vulnerability, consider using private disclosure',
      '1. Do not share exploit details publicly in this issue',
      '2. A security maintainer will review this issue promptly',
      '3. We appreciate responsible disclosure and will credit you in the fix',
    ].join('\n'),

    other: [
      '1. A maintainer will review this issue and provide guidance',
      '2. Please provide any additional context that might be helpful',
    ].join('\n'),
  };

  return steps[issueType] ?? steps.other;
}

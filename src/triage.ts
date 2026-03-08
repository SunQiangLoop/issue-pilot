import { IssuePilotConfig, TriageResult, IssueContext, DuplicateMatch, LabelSuggestion } from './types.js';
import { getIssue, getRecentIssues, addLabels, addComment, assignIssue } from './github.js';
import { analyzeIssue } from './ai.js';
import { findDuplicates } from './duplicate.js';

/**
 * Triage a single GitHub issue.
 */
export async function triageIssue(
  config: IssuePilotConfig,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<TriageResult> {
  // 1. Fetch the issue from GitHub
  const issue = await getIssue(config.githubToken, owner, repo, issueNumber);

  // 2. Get recent issues for duplicate detection
  const recentIssues = await getRecentIssues(config.githubToken, owner, repo, 100);

  // 3. Call AI for analysis
  const analysis = await analyzeIssue(issue.title, issue.body, config);

  // 4. Find duplicates
  const duplicates = findDuplicates(
    issue,
    recentIssues,
    config.duplicateThreshold,
    analysis.duplicateKeywords
  );

  // 5. Determine labels to apply
  const labelsToApply = selectLabels(analysis.suggestedLabels, duplicates, analysis.severity);
  const appliedLabels: string[] = [];

  if (!config.dryRun) {
    // Apply labels
    if (labelsToApply.length > 0) {
      await addLabels(config.githubToken, owner, repo, issueNumber, labelsToApply);
      appliedLabels.push(...labelsToApply);
    }

    // Assign issue if configured and assignees suggested
    if (config.autoAssign && analysis.suggestedAssignees.length > 0) {
      await assignIssue(
        config.githubToken,
        owner,
        repo,
        issueNumber,
        analysis.suggestedAssignees
      );
    }

    // Post triage comment
    const comment = buildTriageComment(issue, analysis, duplicates, labelsToApply);
    await addComment(config.githubToken, owner, repo, issueNumber, comment);

    return {
      issue,
      analysis,
      duplicates,
      appliedLabels,
      commentPosted: true,
      dryRun: false,
    };
  }

  return {
    issue,
    analysis,
    duplicates,
    appliedLabels: labelsToApply, // Show what would be applied
    commentPosted: false,
    dryRun: true,
  };
}

/**
 * Triage all recent open issues in a repository.
 */
export async function triageAllIssues(
  config: IssuePilotConfig,
  owner: string,
  repo: string,
  limit = 20
): Promise<TriageResult[]> {
  const recentIssues = await getRecentIssues(config.githubToken, owner, repo, limit);
  const openIssues = recentIssues.filter((i) => true); // Already filtered by getRecentIssues

  const results: TriageResult[] = [];

  for (const issue of openIssues.slice(0, limit)) {
    try {
      const result = await triageIssue(config, owner, repo, issue.number);
      results.push(result);

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Failed to triage issue #${issue.number}: ${error}`);
    }
  }

  return results;
}

/**
 * Select which labels to apply based on AI suggestions and context.
 */
function selectLabels(
  suggestedLabels: LabelSuggestion[],
  duplicates: DuplicateMatch[],
  severity: string
): string[] {
  const labels = new Set<string>();

  // Add high-confidence AI suggested labels (confidence >= 0.7)
  for (const suggestion of suggestedLabels) {
    if (suggestion.confidence >= 0.7) {
      labels.add(suggestion.name);
    }
  }

  // Add severity label
  const severityLabel = getSeverityLabel(severity);
  if (severityLabel) {
    labels.add(severityLabel);
  }

  // Add duplicate label if duplicates found
  if (duplicates.length > 0) {
    labels.add('duplicate');
  }

  return Array.from(labels);
}

/**
 * Map severity to label name.
 */
function getSeverityLabel(severity: string): string | null {
  const map: Record<string, string> = {
    low: 'low-priority',
    medium: 'medium-priority',
    high: 'high-priority',
    critical: 'critical',
  };
  return map[severity] || null;
}

/**
 * Build the triage comment markdown.
 */
function buildTriageComment(
  issue: IssueContext,
  analysis: { summary: string; issueType: string; severity: string; suggestedLabels: LabelSuggestion[]; suggestedAssignees: string[]; additionalContext: string },
  duplicates: DuplicateMatch[],
  appliedLabels: string[]
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

  const issueTypeDisplay = `${typeEmoji[analysis.issueType] || '📌'} ${capitalize(analysis.issueType)}`;
  const severityDisplay = `${severityEmoji[analysis.severity] || '⚪'} ${capitalize(analysis.severity)}`;

  let comment = `## 🤖 Issue Pilot Triage Report

**Type:** ${issueTypeDisplay} | **Severity:** ${severityDisplay}

**Summary:** ${analysis.summary}

`;

  // Applied Labels section
  if (appliedLabels.length > 0) {
    comment += `### 📋 Applied Labels\n`;
    for (const labelName of appliedLabels) {
      const suggestion = analysis.suggestedLabels.find((s) => s.name === labelName);
      const reason = suggestion?.reason || getLabelDefaultReason(labelName, analysis);
      comment += `- \`${labelName}\` — ${reason}\n`;
    }
    comment += '\n';
  } else {
    comment += `### 📋 Labels\nNo labels were automatically applied for this issue.\n\n`;
  }

  // Potential Duplicates section
  if (duplicates.length > 0) {
    comment += `### 🔍 Potential Duplicates\n`;
    comment += `This issue may be related to existing issues:\n\n`;
    for (const dup of duplicates) {
      const pct = Math.round(dup.similarity * 100);
      comment += `- [#${dup.issueNumber}](${dup.url}) — ${dup.title} *(${pct}% similarity)*\n`;
    }
    comment += `\nPlease check if your issue is already covered before adding new information.\n\n`;
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

  comment += `---\n*Triaged by [Issue Pilot](https://github.com/sunqiang/issue-pilot) 🚀 — AI-powered issue triage*`;

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
    'bug': 'This issue describes unexpected behavior',
    'feature': 'This is a feature or enhancement request',
    'question': 'This issue is a question or support request',
    'docs': 'This is related to documentation',
    'security': 'This issue involves a security concern',
    'low-priority': 'Classified as low severity',
    'medium-priority': 'Classified as medium severity',
    'high-priority': 'Classified as high severity',
    'critical': 'Classified as critical — requires immediate attention',
    'duplicate': 'Potential duplicate of an existing issue detected',
    'needs-info': 'Additional information needed to proceed',
  };
  return reasons[labelName] || `Applied based on ${analysis.issueType} classification`;
}

function getDefaultNextSteps(issueType: string, hasDuplicates: boolean): string {
  if (hasDuplicates) {
    return '1. Review the potential duplicates listed above\n2. If this is indeed a duplicate, please close this issue and add a comment to the original\n3. If this is a new issue, please provide additional context to differentiate it';
  }

  const steps: Record<string, string> = {
    bug: '1. Please ensure steps to reproduce are clearly described\n2. Include your environment details (OS, version, etc.)\n3. A maintainer will review and prioritize this bug report',
    feature: '1. Describe the problem this feature would solve\n2. Share any implementation ideas you have\n3. A maintainer will review feasibility and fit with project goals',
    question: '1. Check the documentation and existing issues first\n2. If your question is not answered, a maintainer will respond shortly\n3. Consider joining our community discussions',
    docs: '1. Point to the specific documentation that needs updating\n2. Suggest the correct information if possible\n3. A maintainer will review and update the docs',
    security: '⚠️ **Security Notice**: Please do not share exploit details publicly\n1. If this is a sensitive vulnerability, consider using private disclosure\n2. A security maintainer will review this promptly',
    other: '1. A maintainer will review this issue and provide guidance\n2. Please provide any additional context that might help',
  };

  return steps[issueType] || steps.other;
}

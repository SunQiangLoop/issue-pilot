/**
 * Triage statistics aggregation and formatting.
 * Provides insights into bulk triage operations.
 */

import { TriageResult, TriageStats, IssueSeverity, IssueType, TokenUsage } from './types.js';

const ZERO_TOKEN_USAGE: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUSD: 0,
};

/**
 * Aggregate statistics from a batch of triage results.
 */
export function aggregateStats(
  results: TriageResult[],
  processingTimeMs: number
): TriageStats {
  const severityBreakdown: Record<IssueSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  const typeBreakdown: Record<IssueType, number> = {
    bug: 0,
    feature: 0,
    question: 0,
    docs: 0,
    security: 0,
    other: 0,
  };

  let totalConfidence = 0;
  let confidenceCount = 0;
  let duplicatesFound = 0;
  let labeledIssues = 0;

  const totalTokenUsage: TokenUsage = { ...ZERO_TOKEN_USAGE };

  for (const result of results) {
    severityBreakdown[result.analysis.severity]++;
    typeBreakdown[result.analysis.issueType]++;

    if (result.duplicates.length > 0) duplicatesFound++;
    if (result.appliedLabels.length > 0) labeledIssues++;

    for (const label of result.analysis.suggestedLabels) {
      totalConfidence += label.confidence;
      confidenceCount++;
    }

    if (result.tokenUsage) {
      totalTokenUsage.promptTokens += result.tokenUsage.promptTokens;
      totalTokenUsage.completionTokens += result.tokenUsage.completionTokens;
      totalTokenUsage.totalTokens += result.tokenUsage.totalTokens;
      totalTokenUsage.estimatedCostUSD += result.tokenUsage.estimatedCostUSD;
    }
  }

  return {
    totalIssues: results.length,
    labeledIssues,
    duplicatesFound,
    avgConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
    severityBreakdown,
    typeBreakdown,
    totalTokenUsage,
    processingTimeMs,
  };
}

const SEVERITY_ICONS: Record<IssueSeverity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};

const TYPE_ICONS: Record<IssueType, string> = {
  bug: '🐛',
  feature: '✨',
  question: '❓',
  docs: '📚',
  security: '🔒',
  other: '📌',
};

/**
 * Format aggregated stats into a human-readable string for CLI output.
 */
export function formatStats(stats: TriageStats): string {
  const bar = '─'.repeat(40);
  const lines: string[] = [
    `📊 Triage Statistics`,
    bar,
    `Issues processed : ${stats.totalIssues}`,
    `Issues labeled   : ${stats.labeledIssues} (${pct(stats.labeledIssues, stats.totalIssues)}%)`,
    `Duplicates found : ${stats.duplicatesFound} (${pct(stats.duplicatesFound, stats.totalIssues)}%)`,
    `Avg confidence   : ${(stats.avgConfidence * 100).toFixed(1)}%`,
    `Processing time  : ${(stats.processingTimeMs / 1000).toFixed(1)}s`,
  ];

  if (stats.totalTokenUsage.totalTokens > 0) {
    lines.push(
      `Tokens used      : ${stats.totalTokenUsage.totalTokens.toLocaleString()}`,
      `Estimated cost   : $${stats.totalTokenUsage.estimatedCostUSD.toFixed(4)}`
    );
  }

  const typeEntries = Object.entries(stats.typeBreakdown).filter(([, n]) => n > 0);
  if (typeEntries.length > 0) {
    lines.push('', '📂 Issue Types:');
    for (const [type, count] of typeEntries) {
      const icon = TYPE_ICONS[type as IssueType] ?? '📌';
      lines.push(`  ${icon} ${type}: ${count}`);
    }
  }

  const severityEntries = Object.entries(stats.severityBreakdown).filter(([, n]) => n > 0);
  if (severityEntries.length > 0) {
    lines.push('', '⚡ Severity Breakdown:');
    for (const [severity, count] of severityEntries) {
      const icon = SEVERITY_ICONS[severity as IssueSeverity] ?? '⚪';
      lines.push(`  ${icon} ${severity}: ${count}`);
    }
  }

  lines.push(bar);
  return lines.join('\n');
}

/**
 * Format a single triage result as a concise summary line.
 */
export function formatResultSummary(result: TriageResult): string {
  const { issue, analysis, appliedLabels, duplicates } = result;
  const typeIcon = TYPE_ICONS[analysis.issueType] ?? '📌';
  const sevIcon = SEVERITY_ICONS[analysis.severity] ?? '⚪';
  const dupNote = duplicates.length > 0 ? ` [${duplicates.length} dup(s)]` : '';
  const labelNote = appliedLabels.length > 0 ? ` labels: ${appliedLabels.join(', ')}` : '';

  return `#${issue.number} ${typeIcon}${sevIcon} ${issue.title.slice(0, 60)}${labelNote}${dupNote}`;
}

function pct(part: number, total: number): string {
  if (total === 0) return '0';
  return ((part / total) * 100).toFixed(0);
}

import { describe, it, expect } from 'vitest';
import { aggregateStats, formatStats, formatResultSummary } from '../src/stats.js';
import { TriageResult, AIAnalysis, IssueContext } from '../src/types.js';

function makeResult(
  issueNumber: number,
  issueType: AIAnalysis['issueType'],
  severity: AIAnalysis['severity'],
  options: Partial<TriageResult> = {}
): TriageResult {
  const issue: IssueContext = {
    number: issueNumber,
    title: `Issue ${issueNumber}`,
    body: 'Body text',
    labels: [],
    author: 'user',
    createdAt: '2026-01-01T00:00:00Z',
    url: `https://github.com/owner/repo/issues/${issueNumber}`,
  };

  const analysis: AIAnalysis = {
    summary: `Summary for issue ${issueNumber}`,
    issueType,
    severity,
    suggestedLabels: [
      { name: 'bug', reason: 'Test', confidence: 0.9 },
      { name: 'high-priority', reason: 'Test', confidence: 0.6 },
    ],
    duplicateKeywords: ['crash', 'upload'],
    suggestedAssignees: [],
    additionalContext: '',
  };

  return {
    issue,
    analysis,
    duplicates: [],
    appliedLabels: ['bug', 'high-priority'],
    commentPosted: true,
    dryRun: false,
    processingTimeMs: 1200,
    ...options,
  };
}

describe('aggregateStats', () => {
  it('returns zero stats for empty results', () => {
    const stats = aggregateStats([], 0);
    expect(stats.totalIssues).toBe(0);
    expect(stats.labeledIssues).toBe(0);
    expect(stats.duplicatesFound).toBe(0);
    expect(stats.avgConfidence).toBe(0);
  });

  it('counts total issues correctly', () => {
    const results = [
      makeResult(1, 'bug', 'high'),
      makeResult(2, 'feature', 'low'),
      makeResult(3, 'question', 'medium'),
    ];
    const stats = aggregateStats(results, 3600);
    expect(stats.totalIssues).toBe(3);
  });

  it('counts labeled issues', () => {
    const results = [
      makeResult(1, 'bug', 'high', { appliedLabels: ['bug'] }),
      makeResult(2, 'feature', 'low', { appliedLabels: [] }),
    ];
    const stats = aggregateStats(results, 1000);
    expect(stats.labeledIssues).toBe(1);
  });

  it('counts duplicates found', () => {
    const results = [
      makeResult(1, 'bug', 'high', {
        duplicates: [{ issueNumber: 5, title: 'Dup', url: '', similarity: 0.9, matchedKeywords: [] }],
      }),
      makeResult(2, 'feature', 'low', { duplicates: [] }),
    ];
    const stats = aggregateStats(results, 2000);
    expect(stats.duplicatesFound).toBe(1);
  });

  it('computes severity breakdown', () => {
    const results = [
      makeResult(1, 'bug', 'high'),
      makeResult(2, 'bug', 'critical'),
      makeResult(3, 'feature', 'low'),
      makeResult(4, 'question', 'high'),
    ];
    const stats = aggregateStats(results, 4000);
    expect(stats.severityBreakdown.high).toBe(2);
    expect(stats.severityBreakdown.critical).toBe(1);
    expect(stats.severityBreakdown.low).toBe(1);
    expect(stats.severityBreakdown.medium).toBe(0);
  });

  it('computes type breakdown', () => {
    const results = [
      makeResult(1, 'bug', 'high'),
      makeResult(2, 'bug', 'medium'),
      makeResult(3, 'feature', 'low'),
    ];
    const stats = aggregateStats(results, 3000);
    expect(stats.typeBreakdown.bug).toBe(2);
    expect(stats.typeBreakdown.feature).toBe(1);
    expect(stats.typeBreakdown.question).toBe(0);
  });

  it('computes average confidence', () => {
    const results = [makeResult(1, 'bug', 'high')];
    const stats = aggregateStats(results, 1000);
    // Two labels: 0.9 and 0.6 → avg = 0.75
    expect(stats.avgConfidence).toBeCloseTo(0.75, 2);
  });

  it('accumulates token usage when present', () => {
    const results = [
      makeResult(1, 'bug', 'high', {
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.001 },
      }),
      makeResult(2, 'feature', 'low', {
        tokenUsage: { promptTokens: 200, completionTokens: 80, totalTokens: 280, estimatedCostUSD: 0.002 },
      }),
    ];
    const stats = aggregateStats(results, 2000);
    expect(stats.totalTokenUsage.promptTokens).toBe(300);
    expect(stats.totalTokenUsage.completionTokens).toBe(130);
    expect(stats.totalTokenUsage.totalTokens).toBe(430);
    expect(stats.totalTokenUsage.estimatedCostUSD).toBeCloseTo(0.003, 5);
  });

  it('stores processingTimeMs', () => {
    const stats = aggregateStats([], 9999);
    expect(stats.processingTimeMs).toBe(9999);
  });
});

describe('formatStats', () => {
  it('returns a non-empty string', () => {
    const results = [makeResult(1, 'bug', 'high')];
    const stats = aggregateStats(results, 1500);
    const output = formatStats(stats);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('includes key metrics', () => {
    const results = [
      makeResult(1, 'bug', 'high'),
      makeResult(2, 'security', 'critical'),
    ];
    const stats = aggregateStats(results, 2500);
    const output = formatStats(stats);
    expect(output).toContain('2');         // total issues
    expect(output).toContain('bug');
    expect(output).toContain('security');
  });

  it('shows token usage when non-zero', () => {
    const results = [
      makeResult(1, 'bug', 'high', {
        tokenUsage: { promptTokens: 500, completionTokens: 200, totalTokens: 700, estimatedCostUSD: 0.005 },
      }),
    ];
    const stats = aggregateStats(results, 1000);
    const output = formatStats(stats);
    expect(output).toContain('700');
    expect(output).toContain('0.0050');
  });

  it('omits token section when zero', () => {
    const results = [makeResult(1, 'bug', 'high', { tokenUsage: undefined })];
    const stats = aggregateStats(results, 1000);
    const output = formatStats(stats);
    expect(output).not.toContain('Tokens used');
  });
});

describe('formatResultSummary', () => {
  it('includes issue number and title', () => {
    const result = makeResult(42, 'bug', 'high');
    const summary = formatResultSummary(result);
    expect(summary).toContain('#42');
    expect(summary).toContain('Issue 42');
  });

  it('includes applied labels', () => {
    const result = makeResult(7, 'feature', 'low', { appliedLabels: ['feature', 'low-priority'] });
    const summary = formatResultSummary(result);
    expect(summary).toContain('feature');
    expect(summary).toContain('low-priority');
  });

  it('notes duplicates found', () => {
    const result = makeResult(3, 'bug', 'high', {
      duplicates: [{ issueNumber: 1, title: 'Old', url: '', similarity: 0.9, matchedKeywords: [] }],
    });
    const summary = formatResultSummary(result);
    expect(summary).toContain('dup');
  });
});

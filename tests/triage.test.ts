import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssuePilotConfig, IssueContext, AIAnalysis } from '../src/types.js';

// Mock all external dependencies before importing triage
vi.mock('../src/github.js', () => ({
  getIssue: vi.fn(),
  getRecentIssues: vi.fn(),
  addLabels: vi.fn(),
  addComment: vi.fn(),
  assignIssue: vi.fn(),
}));

vi.mock('../src/ai.js', () => ({
  analyzeIssue: vi.fn(),
  analyzeIssueWithUsage: vi.fn(),
}));

vi.mock('../src/duplicate.js', () => ({
  findDuplicates: vi.fn(),
}));

import { triageIssue } from '../src/triage.js';
import * as github from '../src/github.js';
import * as ai from '../src/ai.js';
import type { AnalyzeResult } from '../src/ai.js';
import * as duplicate from '../src/duplicate.js';

const mockConfig: IssuePilotConfig = {
  openaiApiKey: 'sk-test',
  githubToken: 'ghp-test',
  labels: [
    { name: 'bug', description: 'Bug', color: 'd73a4a' },
    { name: 'high-priority', description: 'High priority', color: 'e99695' },
  ],
  autoAssign: false,
  duplicateThreshold: 0.85,
  dryRun: false,
  verbose: false,
};

const mockIssue: IssueContext = {
  number: 42,
  title: 'Application crashes on file upload',
  body: 'When uploading files the app crashes with an error.',
  labels: [],
  author: 'testuser',
  createdAt: '2026-01-01T00:00:00Z',
  url: 'https://github.com/owner/repo/issues/42',
};

const mockAnalysis: AIAnalysis = {
  summary: 'App crashes during file upload operation',
  issueType: 'bug',
  severity: 'high',
  suggestedLabels: [
    { name: 'bug', reason: 'Describes unexpected crash behavior', confidence: 0.95 },
    { name: 'high-priority', reason: 'Causes data loss', confidence: 0.8 },
  ],
  duplicateKeywords: ['crash', 'upload', 'file'],
  suggestedAssignees: [],
  additionalContext: '',
};

describe('triageIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(github.getIssue).mockResolvedValue(mockIssue);
    vi.mocked(github.getRecentIssues).mockResolvedValue([]);
    vi.mocked(github.addLabels).mockResolvedValue();
    vi.mocked(github.addComment).mockResolvedValue();
    vi.mocked(ai.analyzeIssue).mockResolvedValue(mockAnalysis);
    vi.mocked(ai.analyzeIssueWithUsage).mockResolvedValue({
      analysis: mockAnalysis,
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.001 },
    } as AnalyzeResult);
    vi.mocked(duplicate.findDuplicates).mockReturnValue([]);
  });

  it('returns a complete TriageResult', async () => {
    const result = await triageIssue(mockConfig, 'owner', 'repo', 42);

    expect(result.issue).toEqual(mockIssue);
    expect(result.analysis).toEqual(mockAnalysis);
    expect(result.duplicates).toEqual([]);
    expect(result.dryRun).toBe(false);
    expect(result.commentPosted).toBe(true);
  });

  it('applies labels with confidence >= 0.7', async () => {
    const result = await triageIssue(mockConfig, 'owner', 'repo', 42);

    expect(github.addLabels).toHaveBeenCalledWith(
      'ghp-test',
      'owner',
      'repo',
      42,
      expect.arrayContaining(['bug', 'high-priority'])
    );
    expect(result.appliedLabels).toContain('bug');
    expect(result.appliedLabels).toContain('high-priority');
  });

  it('does not apply low-confidence labels', async () => {
    vi.mocked(ai.analyzeIssueWithUsage).mockResolvedValue({
      analysis: {
        ...mockAnalysis,
        suggestedLabels: [
          { name: 'bug', reason: 'Might be a bug', confidence: 0.4 },
        ],
      },
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.001 },
    } as AnalyzeResult);

    const result = await triageIssue(mockConfig, 'owner', 'repo', 42);
    // 'bug' should not be in applied labels since confidence is below 0.7
    // Only severity label 'high-priority' should be applied
    expect(result.appliedLabels).not.toContain('bug');
  });

  it('adds duplicate label when duplicates are found', async () => {
    const mockDuplicate = {
      issueNumber: 10,
      title: 'File upload crashes app',
      url: 'https://github.com/owner/repo/issues/10',
      similarity: 0.9,
      matchedKeywords: ['crash', 'upload'],
    };

    vi.mocked(duplicate.findDuplicates).mockReturnValue([mockDuplicate]);

    const result = await triageIssue(mockConfig, 'owner', 'repo', 42);

    expect(result.appliedLabels).toContain('duplicate');
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].issueNumber).toBe(10);
  });

  it('posts a triage comment when not in dry run mode', async () => {
    await triageIssue(mockConfig, 'owner', 'repo', 42);

    expect(github.addComment).toHaveBeenCalledTimes(1);
    const commentArg = vi.mocked(github.addComment).mock.calls[0][4];
    expect(commentArg).toContain('Issue Pilot Triage Report');
    expect(commentArg).toContain('bug');
    expect(commentArg).toContain('high');
  });

  it('skips applying labels and comments in dry run mode', async () => {
    const dryRunConfig = { ...mockConfig, dryRun: true };

    const result = await triageIssue(dryRunConfig, 'owner', 'repo', 42);

    expect(github.addLabels).not.toHaveBeenCalled();
    expect(github.addComment).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.commentPosted).toBe(false);
    // Labels that would be applied are still reported
    expect(result.appliedLabels.length).toBeGreaterThan(0);
  });

  it('calls AI analysis with issue content', async () => {
    await triageIssue(mockConfig, 'owner', 'repo', 42);

    expect(ai.analyzeIssueWithUsage).toHaveBeenCalledWith(
      mockIssue.title,
      mockIssue.body,
      mockConfig
    );
  });

  it('calls duplicate detection with AI keywords', async () => {
    const recentIssues: IssueContext[] = [
      {
        number: 5,
        title: 'Old issue about upload',
        body: 'Details about upload crash',
        labels: [],
        author: 'user',
        createdAt: '2025-12-01T00:00:00Z',
        url: 'https://github.com/owner/repo/issues/5',
      },
    ];
    vi.mocked(github.getRecentIssues).mockResolvedValue(recentIssues);

    await triageIssue(mockConfig, 'owner', 'repo', 42);

    expect(duplicate.findDuplicates).toHaveBeenCalledWith(
      mockIssue,
      recentIssues,
      mockConfig.duplicateThreshold,
      mockAnalysis.duplicateKeywords
    );
  });

  it('assigns issue when autoAssign is true and assignees are suggested', async () => {
    const configWithAutoAssign = { ...mockConfig, autoAssign: true };
    vi.mocked(ai.analyzeIssueWithUsage).mockResolvedValue({
      analysis: { ...mockAnalysis, suggestedAssignees: ['maintainer1'] },
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.001 },
    } as AnalyzeResult);

    await triageIssue(configWithAutoAssign, 'owner', 'repo', 42);

    expect(github.assignIssue).toHaveBeenCalledWith(
      'ghp-test',
      'owner',
      'repo',
      42,
      ['maintainer1']
    );
  });

  it('does not assign when autoAssign is false', async () => {
    vi.mocked(ai.analyzeIssueWithUsage).mockResolvedValue({
      analysis: { ...mockAnalysis, suggestedAssignees: ['maintainer1'] },
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.001 },
    } as AnalyzeResult);

    await triageIssue(mockConfig, 'owner', 'repo', 42);

    expect(github.assignIssue).not.toHaveBeenCalled();
  });

  it('triage comment includes duplicate information', async () => {
    const mockDuplicate = {
      issueNumber: 10,
      title: 'File upload crashes app',
      url: 'https://github.com/owner/repo/issues/10',
      similarity: 0.9,
      matchedKeywords: ['crash', 'upload'],
    };
    vi.mocked(duplicate.findDuplicates).mockReturnValue([mockDuplicate]);

    await triageIssue(mockConfig, 'owner', 'repo', 42);

    const commentArg = vi.mocked(github.addComment).mock.calls[0][4];
    expect(commentArg).toContain('#10');
    expect(commentArg).toContain('Potential Duplicates');
  });
});

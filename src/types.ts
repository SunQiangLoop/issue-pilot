export interface LabelConfig {
  name: string;
  description: string;
  color: string;
}

export interface IssuePilotConfig {
  openaiApiKey: string;
  githubToken: string;
  labels: LabelConfig[];
  autoAssign: boolean;
  duplicateThreshold: number;
  dryRun: boolean;
  verbose: boolean;
}

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueType = 'bug' | 'feature' | 'question' | 'docs' | 'security' | 'other';

export interface LabelSuggestion {
  name: string;
  reason: string;
  confidence: number;
}

export interface DuplicateMatch {
  issueNumber: number;
  title: string;
  url: string;
  similarity: number;
  matchedKeywords: string[];
}

export interface IssueContext {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
  createdAt: string;
  url: string;
}

export interface AIAnalysis {
  summary: string;
  issueType: IssueType;
  severity: IssueSeverity;
  suggestedLabels: LabelSuggestion[];
  duplicateKeywords: string[];
  suggestedAssignees: string[];
  additionalContext: string;
}

export interface TriageResult {
  issue: IssueContext;
  analysis: AIAnalysis;
  duplicates: DuplicateMatch[];
  appliedLabels: string[];
  commentPosted: boolean;
  dryRun: boolean;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name?: string }>;
  user: { login: string } | null;
  created_at: string;
  html_url: string;
  assignees: Array<{ login: string }>;
}

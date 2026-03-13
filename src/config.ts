import { cosmiconfig } from 'cosmiconfig';
import { IssuePilotConfig, LabelConfig } from './types.js';

const DEFAULT_LABELS: LabelConfig[] = [
  // Issue types
  { name: 'bug', description: 'Something is not working as expected', color: 'd73a4a' },
  { name: 'feature', description: 'New feature or enhancement request', color: 'a2eeef' },
  { name: 'enhancement', description: 'Improvement to an existing feature', color: '84b6eb' },
  { name: 'question', description: 'Further information is requested', color: 'd876e3' },
  { name: 'docs', description: 'Improvements or additions to documentation', color: '0075ca' },
  { name: 'security', description: 'Security vulnerability or concern', color: 'e4e669' },
  // Priority / severity
  { name: 'low-priority', description: 'Low priority — minimal user impact', color: 'c5def5' },
  { name: 'medium-priority', description: 'Medium priority — moderate user impact', color: 'fbca04' },
  { name: 'high-priority', description: 'High priority — significant user impact', color: 'e99695' },
  { name: 'critical', description: 'Critical — requires immediate attention', color: 'b60205' },
  // Workflow
  { name: 'duplicate', description: 'This issue or PR already exists', color: 'cfd3d7' },
  { name: 'needs-info', description: 'More information needed to proceed', color: 'ffffff' },
  { name: 'good-first-issue', description: 'Good for newcomers', color: '7057ff' },
  { name: 'help-wanted', description: 'Community contributions are welcome', color: '008672' },
  { name: 'wontfix', description: 'This will not be worked on', color: 'ffffff' },
  { name: 'invalid', description: 'This does not seem right or cannot be reproduced', color: 'e4e669' },
];

const DEFAULT_CONFIG: IssuePilotConfig = {
  openaiApiKey: '',
  githubToken: '',
  labels: DEFAULT_LABELS,
  autoAssign: false,
  duplicateThreshold: 0.85,
  confidenceThreshold: 0.7,
  dryRun: false,
  verbose: false,
  model: 'gpt-4o',
  maxIssues: 50,
};

export async function loadConfig(overrides: Partial<IssuePilotConfig> = {}): Promise<IssuePilotConfig> {
  const explorer = cosmiconfig('issue-pilot');

  let fileConfig: Partial<IssuePilotConfig> = {};
  try {
    const result = await explorer.search();
    if (result?.config) {
      fileConfig = result.config as Partial<IssuePilotConfig>;
    }
  } catch {
    // No config file found — use defaults
  }

  const envConfig: Partial<IssuePilotConfig> = {
    openaiApiKey: process.env.OPENAI_API_KEY || process.env.INPUT_OPENAI_API_KEY || undefined,
    githubToken: process.env.GITHUB_TOKEN || process.env.INPUT_GITHUB_TOKEN || undefined,
    dryRun: process.env.DRY_RUN === 'true' || process.env.INPUT_DRY_RUN === 'true' || undefined,
    duplicateThreshold: process.env.DUPLICATE_THRESHOLD
      ? parseFloat(process.env.DUPLICATE_THRESHOLD)
      : process.env.INPUT_DUPLICATE_THRESHOLD
      ? parseFloat(process.env.INPUT_DUPLICATE_THRESHOLD)
      : undefined,
    confidenceThreshold: process.env.CONFIDENCE_THRESHOLD
      ? parseFloat(process.env.CONFIDENCE_THRESHOLD)
      : undefined,
    autoAssign: process.env.AUTO_ASSIGN === 'true' || undefined,
    model: process.env.OPENAI_MODEL || process.env.INPUT_MODEL || undefined,
    maxIssues: process.env.MAX_ISSUES ? parseInt(process.env.MAX_ISSUES, 10) : undefined,
  };

  // Parse labels from INPUT_LABELS if provided (GitHub Actions context)
  if (process.env.INPUT_LABELS) {
    try {
      envConfig.labels = JSON.parse(process.env.INPUT_LABELS) as LabelConfig[];
    } catch {
      console.warn('Warning: Failed to parse INPUT_LABELS JSON — using defaults');
    }
  }

  // Strip undefined values so spread merging works correctly
  for (const key of Object.keys(envConfig) as (keyof IssuePilotConfig)[]) {
    if (envConfig[key] === undefined) {
      delete envConfig[key];
    }
  }

  const config: IssuePilotConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...overrides,
  };

  // Validate required fields
  if (!config.openaiApiKey) {
    throw new Error(
      'Missing OpenAI API key. Set OPENAI_API_KEY environment variable or configure openaiApiKey in .issue-pilot.json'
    );
  }

  if (!config.githubToken) {
    throw new Error(
      'Missing GitHub token. Set GITHUB_TOKEN environment variable or configure githubToken in .issue-pilot.json'
    );
  }

  if (config.duplicateThreshold < 0 || config.duplicateThreshold > 1) {
    throw new Error('duplicateThreshold must be between 0 and 1');
  }

  if (config.confidenceThreshold < 0 || config.confidenceThreshold > 1) {
    throw new Error('confidenceThreshold must be between 0 and 1');
  }

  if (config.maxIssues < 1 || config.maxIssues > 500) {
    throw new Error('maxIssues must be between 1 and 500');
  }

  return config;
}

export { DEFAULT_LABELS };

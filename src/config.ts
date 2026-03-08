import { cosmiconfig } from 'cosmiconfig';
import { IssuePilotConfig, LabelConfig } from './types.js';

const DEFAULT_LABELS: LabelConfig[] = [
  { name: 'bug', description: 'Something is not working as expected', color: 'd73a4a' },
  { name: 'feature', description: 'New feature or enhancement request', color: 'a2eeef' },
  { name: 'question', description: 'Further information is requested', color: 'd876e3' },
  { name: 'docs', description: 'Improvements or additions to documentation', color: '0075ca' },
  { name: 'security', description: 'Security vulnerability or concern', color: 'e4e669' },
  { name: 'low-priority', description: 'Low priority issue', color: 'c5def5' },
  { name: 'medium-priority', description: 'Medium priority issue', color: 'fbca04' },
  { name: 'high-priority', description: 'High priority issue', color: 'e99695' },
  { name: 'critical', description: 'Critical issue requiring immediate attention', color: 'b60205' },
  { name: 'duplicate', description: 'This issue or PR already exists', color: 'cfd3d7' },
  { name: 'needs-info', description: 'More information needed to proceed', color: 'ffffff' },
  { name: 'good-first-issue', description: 'Good for newcomers', color: '7057ff' },
];

const DEFAULT_CONFIG: IssuePilotConfig = {
  openaiApiKey: '',
  githubToken: '',
  labels: DEFAULT_LABELS,
  autoAssign: false,
  duplicateThreshold: 0.85,
  dryRun: false,
  verbose: false,
};

export async function loadConfig(overrides: Partial<IssuePilotConfig> = {}): Promise<IssuePilotConfig> {
  const explorer = cosmiconfig('issue-pilot');

  let fileConfig: Partial<IssuePilotConfig> = {};
  try {
    const result = await explorer.search();
    if (result && result.config) {
      fileConfig = result.config as Partial<IssuePilotConfig>;
    }
  } catch {
    // No config file found, use defaults
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
    autoAssign: process.env.AUTO_ASSIGN === 'true' || undefined,
  };

  // Parse labels from INPUT_LABELS if provided (GitHub Action context)
  if (process.env.INPUT_LABELS) {
    try {
      envConfig.labels = JSON.parse(process.env.INPUT_LABELS) as LabelConfig[];
    } catch {
      console.warn('Warning: Failed to parse INPUT_LABELS JSON, using defaults');
    }
  }

  // Remove undefined values from envConfig
  Object.keys(envConfig).forEach((key) => {
    if (envConfig[key as keyof IssuePilotConfig] === undefined) {
      delete envConfig[key as keyof IssuePilotConfig];
    }
  });

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

  return config;
}

export { DEFAULT_LABELS };

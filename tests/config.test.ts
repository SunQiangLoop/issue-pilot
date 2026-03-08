import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    // Set required values
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.GITHUB_TOKEN = 'ghp_test_token';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads required values from environment variables', async () => {
    const config = await loadConfig();
    expect(config.openaiApiKey).toBe('sk-test-key');
    expect(config.githubToken).toBe('ghp_test_token');
  });

  it('applies default values for optional settings', async () => {
    const config = await loadConfig();
    expect(config.duplicateThreshold).toBe(0.85);
    expect(config.autoAssign).toBe(false);
    expect(config.dryRun).toBe(false);
    expect(config.verbose).toBe(false);
    expect(config.labels.length).toBeGreaterThan(0);
  });

  it('overrides defaults with environment variables', async () => {
    process.env.DUPLICATE_THRESHOLD = '0.7';
    process.env.AUTO_ASSIGN = 'true';
    process.env.DRY_RUN = 'true';

    const config = await loadConfig();
    expect(config.duplicateThreshold).toBe(0.7);
    expect(config.autoAssign).toBe(true);
    expect(config.dryRun).toBe(true);
  });

  it('allows overrides from passed options', async () => {
    const config = await loadConfig({ dryRun: true, verbose: true });
    expect(config.dryRun).toBe(true);
    expect(config.verbose).toBe(true);
  });

  it('throws when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.INPUT_OPENAI_API_KEY;

    await expect(loadConfig()).rejects.toThrow(/openai api key/i);
  });

  it('throws when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.INPUT_GITHUB_TOKEN;

    await expect(loadConfig()).rejects.toThrow(/github token/i);
  });

  it('throws when duplicateThreshold is out of range', async () => {
    await expect(loadConfig({ duplicateThreshold: 1.5 })).rejects.toThrow(
      /duplicateThreshold must be between 0 and 1/i
    );
  });

  it('throws when duplicateThreshold is negative', async () => {
    await expect(loadConfig({ duplicateThreshold: -0.1 })).rejects.toThrow(
      /duplicateThreshold must be between 0 and 1/i
    );
  });

  it('accepts duplicateThreshold at boundaries', async () => {
    const config0 = await loadConfig({ duplicateThreshold: 0 });
    expect(config0.duplicateThreshold).toBe(0);

    const config1 = await loadConfig({ duplicateThreshold: 1 });
    expect(config1.duplicateThreshold).toBe(1);
  });

  it('defaults include standard label set', async () => {
    const config = await loadConfig();
    const labelNames = config.labels.map((l) => l.name);

    expect(labelNames).toContain('bug');
    expect(labelNames).toContain('feature');
    expect(labelNames).toContain('critical');
    expect(labelNames).toContain('duplicate');
  });

  it('parses INPUT_LABELS when provided', async () => {
    const customLabels = [
      { name: 'custom-bug', description: 'Custom bug label', color: 'ff0000' },
    ];
    process.env.INPUT_LABELS = JSON.stringify(customLabels);

    const config = await loadConfig();
    expect(config.labels).toEqual(customLabels);

    delete process.env.INPUT_LABELS;
  });

  it('falls back to defaults when INPUT_LABELS is invalid JSON', async () => {
    process.env.INPUT_LABELS = 'not-valid-json{{{';

    // Should not throw, should use defaults
    const config = await loadConfig();
    expect(config.labels.length).toBeGreaterThan(0);
    expect(config.labels[0].name).toBe('bug'); // First default label

    delete process.env.INPUT_LABELS;
  });

  it('reads from GitHub Action input env vars', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GITHUB_TOKEN;
    process.env['INPUT_OPENAI-API-KEY'] = 'sk-action-key';
    process.env['INPUT_GITHUB-TOKEN'] = 'ghp_action_token';

    const config = await loadConfig({
      openaiApiKey: process.env['INPUT_OPENAI-API-KEY'],
      githubToken: process.env['INPUT_GITHUB-TOKEN'],
    });

    expect(config.openaiApiKey).toBe('sk-action-key');
    expect(config.githubToken).toBe('ghp_action_token');
  });
});

/**
 * GitHub Action entry point for Issue Pilot.
 *
 * This file is compiled to dist/action/index.js and executed by the GitHub
 * Actions runner when the action is triggered.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import { loadConfig } from '../src/config.js';
import { triageIssue } from '../src/triage.js';

interface GitHubEventPayload {
  action?: string;
  issue?: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    user: { login: string } | null;
  };
  repository?: {
    owner: { login: string };
    name: string;
  };
}

async function run(): Promise<void> {
  try {
    // ── Parse GitHub event context ────────────────────────────────────────────

    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error('GITHUB_EVENT_PATH is not set. This action must run inside GitHub Actions.');
    }

    const rawEvent = fs.readFileSync(eventPath, 'utf8');
    const event = JSON.parse(rawEvent) as GitHubEventPayload;

    const issueNumber = event.issue?.number;
    const owner = event.repository?.owner?.login;
    const repo = event.repository?.name;

    if (!issueNumber || !owner || !repo) {
      throw new Error(
        `Could not determine issue context from event payload.\n` +
        `Make sure this action is triggered by an 'issues' event.\n` +
        `Event action: ${event.action}, issue: ${JSON.stringify(event.issue)}`
      );
    }

    // Only process 'opened' and 'reopened' events by default
    const action = event.action;
    if (action && !['opened', 'reopened', 'edited'].includes(action)) {
      core.info(`Skipping action "${action}" — Issue Pilot only processes opened/reopened/edited events`);
      setEmptyOutputs();
      return;
    }

    core.info(`Processing issue #${issueNumber} in ${owner}/${repo} (action: ${action})`);

    // ── Load config ───────────────────────────────────────────────────────────

    const dryRunInput = process.env['INPUT_DRY-RUN'] || process.env.INPUT_DRY_RUN || 'false';
    const thresholdInput = process.env['INPUT_DUPLICATE-THRESHOLD'] || process.env.INPUT_DUPLICATE_THRESHOLD || '0.85';

    const config = await loadConfig({
      openaiApiKey: process.env['INPUT_OPENAI-API-KEY'] || process.env.INPUT_OPENAI_API_KEY || '',
      githubToken: process.env['INPUT_GITHUB-TOKEN'] || process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '',
      dryRun: dryRunInput === 'true',
      duplicateThreshold: parseFloat(thresholdInput) || 0.85,
    });

    // ── Run triage ────────────────────────────────────────────────────────────

    core.info(`Running triage${config.dryRun ? ' (dry run)' : ''}...`);
    const result = await triageIssue(config, owner, repo, issueNumber);

    // ── Set outputs ───────────────────────────────────────────────────────────

    core.setOutput('labels-applied', result.appliedLabels.join(','));
    core.setOutput('is-duplicate', String(result.duplicates.length > 0));
    core.setOutput('severity', result.analysis.severity);
    core.setOutput('issue-type', result.analysis.issueType);
    core.setOutput('summary', result.analysis.summary);

    // ── Summary in GitHub Actions UI ─────────────────────────────────────────

    await core.summary
      .addHeading('🤖 Issue Pilot Triage Results', 2)
      .addTable([
        [{ data: 'Property', header: true }, { data: 'Value', header: true }],
        ['Issue', `#${issueNumber}`],
        ['Type', result.analysis.issueType],
        ['Severity', result.analysis.severity],
        ['Labels Applied', result.appliedLabels.join(', ') || 'none'],
        ['Duplicates Found', String(result.duplicates.length)],
        ['Dry Run', String(config.dryRun)],
      ])
      .addRaw(`**Summary:** ${result.analysis.summary}`)
      .write();

    core.info(`✅ Triage complete for issue #${issueNumber}`);
    core.info(`   Type: ${result.analysis.issueType}`);
    core.info(`   Severity: ${result.analysis.severity}`);
    core.info(`   Labels: ${result.appliedLabels.join(', ') || 'none'}`);
    core.info(`   Duplicates: ${result.duplicates.length}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Issue Pilot failed: ${message}`);
    setEmptyOutputs();
  }
}

function setEmptyOutputs(): void {
  core.setOutput('labels-applied', '');
  core.setOutput('is-duplicate', 'false');
  core.setOutput('severity', '');
  core.setOutput('issue-type', '');
  core.setOutput('summary', '');
}

run();

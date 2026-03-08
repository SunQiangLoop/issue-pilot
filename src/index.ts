#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from './config.js';
import { triageIssue, triageAllIssues } from './triage.js';
import { ensureLabelsExist } from './github.js';
import { TriageResult } from './types.js';
import 'dotenv/config';

const program = new Command();

program
  .name('issue-pilot')
  .description('AI-powered GitHub Issue triage — automatically label, deduplicate, and route issues')
  .version('1.0.0');

// ─── triage command ──────────────────────────────────────────────────────────

program
  .command('triage <repo> <issue-number>')
  .description('Triage a single GitHub issue using AI')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--config <path>', 'Path to config file')
  .option('--verbose', 'Show detailed output')
  .action(async (repo: string, issueNumberStr: string, options: { dryRun?: boolean; config?: string; verbose?: boolean }) => {
    const [owner, repoName] = parseRepo(repo);
    const issueNumber = parseInt(issueNumberStr, 10);

    if (isNaN(issueNumber)) {
      console.error(chalk.red('Error: issue-number must be a valid integer'));
      process.exit(1);
    }

    const spinner = ora(`Triaging issue #${issueNumber} in ${owner}/${repoName}...`).start();

    try {
      const config = await loadConfig({
        dryRun: options.dryRun,
        verbose: options.verbose,
      });

      spinner.text = 'Fetching issue details...';
      const result = await triageIssue(config, owner, repoName, issueNumber);

      spinner.succeed(chalk.green(`Issue #${issueNumber} triaged successfully`));
      printTriageResult(result, options.verbose);
    } catch (error) {
      spinner.fail(chalk.red('Triage failed'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// ─── triage-all command ───────────────────────────────────────────────────────

program
  .command('triage-all <repo>')
  .description('Triage recent open issues in a repository')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--limit <number>', 'Maximum number of issues to triage', '20')
  .option('--config <path>', 'Path to config file')
  .option('--verbose', 'Show detailed output')
  .action(async (repo: string, options: { dryRun?: boolean; limit: string; config?: string; verbose?: boolean }) => {
    const [owner, repoName] = parseRepo(repo);
    const limit = parseInt(options.limit, 10) || 20;

    const spinner = ora(`Triaging up to ${limit} issues in ${owner}/${repoName}...`).start();

    try {
      const config = await loadConfig({
        dryRun: options.dryRun,
        verbose: options.verbose,
      });

      const results = await triageAllIssues(config, owner, repoName, limit);

      spinner.succeed(chalk.green(`Triaged ${results.length} issues`));
      printTriageTable(results);
    } catch (error) {
      spinner.fail(chalk.red('Triage failed'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// ─── setup command ─────────────────────────────────────────────────────────────

program
  .command('setup <repo>')
  .description('Create default Issue Pilot labels in a repository')
  .option('--config <path>', 'Path to config file')
  .option('--verbose', 'Show detailed output')
  .action(async (repo: string, options: { config?: string; verbose?: boolean }) => {
    const [owner, repoName] = parseRepo(repo);
    const spinner = ora(`Setting up labels in ${owner}/${repoName}...`).start();

    try {
      const config = await loadConfig({ verbose: options.verbose });

      const { created, updated, existing } = await ensureLabelsExist(
        config.githubToken,
        owner,
        repoName,
        config.labels
      );

      spinner.succeed(chalk.green('Labels configured successfully'));

      if (created.length > 0) {
        console.log(chalk.green(`  ✓ Created: ${created.join(', ')}`));
      }
      if (updated.length > 0) {
        console.log(chalk.yellow(`  ~ Updated: ${updated.join(', ')}`));
      }
      if (existing.length > 0) {
        console.log(chalk.gray(`  · Unchanged: ${existing.join(', ')}`));
      }

      console.log(
        chalk.cyan(`\n${chalk.bold('Issue Pilot')} is ready for ${owner}/${repoName}!`)
      );
      console.log(
        chalk.gray(
          'Add the GitHub Action to your workflow to auto-triage new issues.\n' +
          'See: https://github.com/sunqiang/issue-pilot#github-action'
        )
      );
    } catch (error) {
      spinner.fail(chalk.red('Setup failed'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRepo(repo: string): [string, string] {
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.error(chalk.red(`Error: Invalid repo format "${repo}". Expected "owner/repo"`));
    process.exit(1);
  }
  return [parts[0], parts[1]];
}

function printTriageResult(result: TriageResult, verbose = false): void {
  const { issue, analysis, duplicates, appliedLabels, dryRun } = result;

  const dryRunBadge = dryRun ? chalk.yellow(' [DRY RUN]') : '';

  console.log('');
  console.log(chalk.bold(`Issue #${issue.number}: ${issue.title}${dryRunBadge}`));
  console.log(chalk.gray(`  ${issue.url}`));
  console.log('');

  console.log(`  ${chalk.bold('Type:')}     ${formatType(analysis.issueType)}`);
  console.log(`  ${chalk.bold('Severity:')} ${formatSeverity(analysis.severity)}`);
  console.log(`  ${chalk.bold('Summary:')}  ${analysis.summary}`);
  console.log('');

  if (appliedLabels.length > 0) {
    const prefix = dryRun ? chalk.yellow('Would apply') : chalk.green('Applied');
    console.log(`  ${chalk.bold('Labels:')} ${prefix}:`);
    for (const label of appliedLabels) {
      console.log(`    ${chalk.cyan('•')} ${chalk.cyan(label)}`);
    }
  } else {
    console.log(`  ${chalk.bold('Labels:')} ${chalk.gray('None applied')}`);
  }
  console.log('');

  if (duplicates.length > 0) {
    console.log(`  ${chalk.bold('Potential Duplicates:')}`);
    for (const dup of duplicates) {
      const pct = Math.round(dup.similarity * 100);
      console.log(
        `    ${chalk.yellow('⚠')} #${dup.issueNumber} — ${dup.title} ${chalk.gray(`(${pct}% match)`)}`
      );
    }
    console.log('');
  }

  if (verbose && analysis.additionalContext) {
    console.log(`  ${chalk.bold('Context:')} ${analysis.additionalContext}`);
    console.log('');
  }

  if (dryRun) {
    console.log(chalk.yellow('  ℹ Dry run: no changes were made to GitHub'));
  } else if (result.commentPosted) {
    console.log(chalk.green('  ✓ Triage comment posted to issue'));
  }
}

function printTriageTable(results: TriageResult[]): void {
  if (results.length === 0) {
    console.log(chalk.gray('\n  No issues to display.'));
    return;
  }

  console.log('');
  console.log(
    chalk.bold(
      `  ${'#'.padEnd(6)} ${'Title'.padEnd(40)} ${'Type'.padEnd(10)} ${'Severity'.padEnd(10)} ${'Labels'.padEnd(20)} ${'Dups'}`
    )
  );
  console.log(chalk.gray('  ' + '─'.repeat(100)));

  for (const result of results) {
    const { issue, analysis, duplicates, appliedLabels, dryRun } = result;
    const truncatedTitle = issue.title.length > 38 ? issue.title.slice(0, 35) + '...' : issue.title;
    const labelsDisplay =
      appliedLabels.length > 0
        ? appliedLabels.slice(0, 3).join(', ').slice(0, 18)
        : chalk.gray('none');
    const dupsDisplay = duplicates.length > 0 ? chalk.yellow(String(duplicates.length)) : chalk.gray('0');
    const dryRunMark = dryRun ? chalk.yellow('*') : ' ';

    console.log(
      `${dryRunMark} ${chalk.cyan(`#${issue.number}`.padEnd(6))} ${truncatedTitle.padEnd(40)} ` +
      `${formatType(analysis.issueType).padEnd(18)} ${formatSeverity(analysis.severity).padEnd(18)} ` +
      `${labelsDisplay.padEnd(20)} ${dupsDisplay}`
    );
  }

  console.log('');
  const dryRunCount = results.filter((r) => r.dryRun).length;
  if (dryRunCount > 0) {
    console.log(chalk.yellow(`  * Dry run — no changes applied`));
  }
}

type ChalkFn = (text: string) => string;

function formatType(type: string): string {
  const colors: Record<string, ChalkFn> = {
    bug: chalk.red,
    feature: chalk.cyan,
    question: chalk.magenta,
    docs: chalk.blue,
    security: chalk.yellow,
    other: chalk.gray,
  };
  const fn = colors[type] || chalk.gray;
  return fn(type);
}

function formatSeverity(severity: string): string {
  const colors: Record<string, ChalkFn> = {
    low: chalk.green,
    medium: chalk.yellow,
    high: chalk.red,
    critical: chalk.bgRed,
  };
  const fn = colors[severity] || chalk.gray;
  return fn(severity);
}

program.parse(process.argv);

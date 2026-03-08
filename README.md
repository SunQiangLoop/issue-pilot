# 🚀 Issue Pilot

> AI-powered GitHub Issue triage — automatically label, deduplicate, and route issues using GPT-4o

[![npm version](https://img.shields.io/npm/v/issue-pilot?color=blue&label=npm)](https://www.npmjs.com/package/issue-pilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/sunqiang/issue-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/sunqiang/issue-pilot/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![GitHub Stars](https://img.shields.io/github/stars/sunqiang/issue-pilot?style=social)](https://github.com/sunqiang/issue-pilot)

Issue Pilot is an open-source CLI tool and GitHub Action that uses GPT-4o to automatically triage GitHub issues as soon as they are opened. It classifies issue types, suggests and applies labels, detects potential duplicates using TF-IDF similarity, and posts a structured triage report as a comment — all without any manual effort.

---

## Screenshots

```
$ issue-pilot triage owner/my-repo 42

✔ Issue #42 triaged successfully

  Issue #42: Application crashes when uploading files larger than 10MB
    https://github.com/owner/my-repo/issues/42

  Type:     🐛 bug
  Severity: 🟠 high
  Summary:  Application throws unhandled exception when processing file uploads exceeding 10MB limit

  Labels: Applied:
    • bug
    • high-priority

  Potential Duplicates:
    ⚠ #38 — File upload fails on large files (91% match)
    ⚠ #29 — Upload size limit not enforced properly (78% match)

  ✓ Triage comment posted to issue
```

---

## Features

- **AI-Powered Labeling** — GPT-4o reads the issue title and body and suggests the most relevant labels from your configured label set
- **Automatic Severity Classification** — Issues are classified as low, medium, high, or critical based on their content
- **Issue Type Detection** — Automatically detects bug, feature, question, docs, security, or other
- **Duplicate Detection** — Uses TF-IDF text similarity (no external dependencies) combined with AI-extracted keywords to find related existing issues
- **Structured Triage Comments** — Posts a clean, markdown-formatted triage report as a comment on every triaged issue
- **Dry Run Mode** — Preview what Issue Pilot would do without making any changes to your repository
- **GitHub Action** — Drop-in action that triggers automatically when new issues are opened
- **CLI Tool** — Triage individual issues or entire repositories from your terminal
- **Configurable Labels** — Define your own label taxonomy via JSON config
- **Zero Required Setup** — Works out of the box with a default label set

---

## Quick Start

### As a GitHub Action

Add Issue Pilot to your repository by creating `.github/workflows/issue-triage.yml`:

```yaml
name: Issue Triage

on:
  issues:
    types: [opened, reopened]

jobs:
  triage:
    name: AI Triage
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: read

    steps:
      - name: Run Issue Pilot
        uses: sunqiang/issue-pilot@v1
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          duplicate-threshold: '0.85'
          dry-run: 'false'
```

**Required secrets:**
1. Add `OPENAI_API_KEY` to your repository secrets at `Settings → Secrets and variables → Actions`
2. `GITHUB_TOKEN` is provided automatically by GitHub Actions

That's it! Issue Pilot will now automatically triage every new issue.

---

### As a CLI Tool

**Install globally:**

```bash
npm install -g issue-pilot
```

**Set up environment variables:**

```bash
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY and GITHUB_TOKEN
```

**Triage a single issue:**

```bash
issue-pilot triage owner/repo 42
```

**Triage with dry run (preview only):**

```bash
issue-pilot triage owner/repo 42 --dry-run
```

**Triage recent open issues in bulk:**

```bash
issue-pilot triage-all owner/repo --limit 50
```

**Create default labels in a repository:**

```bash
issue-pilot setup owner/repo
```

---

## Configuration

Issue Pilot can be configured via:
1. Environment variables (highest priority)
2. `.issue-pilot.json` in your project root
3. `issue-pilot` field in `package.json`
4. Built-in defaults

### `.issue-pilot.json` Example

```json
{
  "duplicateThreshold": 0.85,
  "autoAssign": false,
  "dryRun": false,
  "labels": [
    { "name": "bug", "description": "Something is not working as expected", "color": "d73a4a" },
    { "name": "feature", "description": "New feature or enhancement request", "color": "a2eeef" },
    { "name": "question", "description": "Further information is requested", "color": "d876e3" },
    { "name": "high-priority", "description": "High priority issue", "color": "e99695" },
    { "name": "critical", "description": "Critical issue requiring immediate attention", "color": "b60205" }
  ]
}
```

### Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `openaiApiKey` | `string` | — | OpenAI API key (required) |
| `githubToken` | `string` | — | GitHub personal access token (required) |
| `labels` | `LabelConfig[]` | See defaults | Array of label configurations |
| `autoAssign` | `boolean` | `false` | Auto-assign suggested team members |
| `duplicateThreshold` | `number` | `0.85` | Minimum similarity (0–1) to flag as duplicate |
| `dryRun` | `boolean` | `false` | Analyze without applying changes |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `GITHUB_TOKEN` | GitHub token |
| `DUPLICATE_THRESHOLD` | Duplicate similarity threshold |
| `AUTO_ASSIGN` | Enable auto-assignment (`"true"`) |
| `DRY_RUN` | Dry run mode (`"true"`) |

---

## GitHub Action Inputs & Outputs

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `openai-api-key` | Yes | — | OpenAI API key |
| `github-token` | Yes | `${{ github.token }}` | GitHub token |
| `labels` | No | Default set | JSON array of label configs |
| `dry-run` | No | `false` | Preview mode |
| `duplicate-threshold` | No | `0.85` | Duplicate detection threshold |
| `auto-assign` | No | `false` | Auto-assign team members |

### Outputs

| Output | Description |
|--------|-------------|
| `labels-applied` | Comma-separated list of applied labels |
| `is-duplicate` | `"true"` if a potential duplicate was found |
| `severity` | Detected severity: `low`, `medium`, `high`, or `critical` |
| `issue-type` | Detected type: `bug`, `feature`, `question`, `docs`, `security`, or `other` |
| `summary` | AI-generated one-sentence summary |

### Using Outputs in Your Workflow

```yaml
- name: Run Issue Pilot
  id: triage
  uses: sunqiang/issue-pilot@v1
  with:
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}

- name: Close if duplicate
  if: steps.triage.outputs.is-duplicate == 'true'
  uses: actions/github-script@v7
  with:
    script: |
      await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        state: 'closed',
        state_reason: 'not_planned'
      });
```

---

## Default Labels

Issue Pilot creates and manages the following labels by default:

| Label | Color | Description |
|-------|-------|-------------|
| `bug` | ![#d73a4a](https://placehold.co/12x12/d73a4a/d73a4a.png) Red | Something is not working as expected |
| `feature` | ![#a2eeef](https://placehold.co/12x12/a2eeef/a2eeef.png) Cyan | New feature or enhancement request |
| `question` | ![#d876e3](https://placehold.co/12x12/d876e3/d876e3.png) Purple | Further information is requested |
| `docs` | ![#0075ca](https://placehold.co/12x12/0075ca/0075ca.png) Blue | Documentation improvements |
| `security` | ![#e4e669](https://placehold.co/12x12/e4e669/e4e669.png) Yellow | Security vulnerability or concern |
| `low-priority` | ![#c5def5](https://placehold.co/12x12/c5def5/c5def5.png) Light Blue | Low priority issue |
| `medium-priority` | ![#fbca04](https://placehold.co/12x12/fbca04/fbca04.png) Gold | Medium priority issue |
| `high-priority` | ![#e99695](https://placehold.co/12x12/e99695/e99695.png) Salmon | High priority issue |
| `critical` | ![#b60205](https://placehold.co/12x12/b60205/b60205.png) Dark Red | Critical — requires immediate attention |
| `duplicate` | ![#cfd3d7](https://placehold.co/12x12/cfd3d7/cfd3d7.png) Gray | Potential duplicate of existing issue |
| `needs-info` | ![#ffffff](https://placehold.co/12x12/ffffff/ffffff.png) White | More information needed |
| `good-first-issue` | ![#7057ff](https://placehold.co/12x12/7057ff/7057ff.png) Violet | Good for newcomers |

---

## How It Works

1. **Event Trigger** — A new issue is opened in your repository, triggering the GitHub Action (or you run `issue-pilot triage` from the CLI)

2. **Fetch Context** — Issue Pilot fetches the issue details and up to 100 recent issues for duplicate comparison

3. **AI Analysis** — The issue title and body are sent to GPT-4o with a structured prompt. The AI returns:
   - Issue type classification
   - Severity assessment
   - Suggested labels with confidence scores
   - A concise one-sentence summary
   - Keywords for duplicate detection

4. **Duplicate Detection** — Issue Pilot computes TF-IDF vectors for the new issue and all recent issues, then measures cosine similarity. AI-extracted keywords provide an additional matching signal (up to 20% boost). Issues above the threshold are flagged.

5. **Apply Results** — Labels with ≥70% confidence are applied. If duplicates are found, the `duplicate` label is added. A formatted triage report is posted as an issue comment.

6. **Action Outputs** — The GitHub Action sets outputs (`labels-applied`, `is-duplicate`, `severity`) for use in downstream workflow steps.

---

## CLI Reference

```
Usage: issue-pilot [options] [command]

Options:
  -V, --version          output the version number
  -h, --help             display help for command

Commands:
  triage <repo> <issue-number>   Triage a single GitHub issue using AI
  triage-all <repo>              Triage recent open issues in a repository
  setup <repo>                   Create default Issue Pilot labels in a repository
  help [command]                 display help for command
```

### `triage` options

```
Options:
  --dry-run        Preview changes without applying them
  --config <path>  Path to config file
  --verbose        Show detailed output
  -h, --help       display help for command
```

### `triage-all` options

```
Options:
  --dry-run          Preview changes without applying them
  --limit <number>   Maximum number of issues to triage (default: "20")
  --config <path>    Path to config file
  --verbose          Show detailed output
  -h, --help         display help for command
```

---

## Costs

Issue Pilot uses GPT-4o to analyze issues. Approximate costs per issue:

- Input: ~300–800 tokens
- Output: ~200–400 tokens
- Estimated cost: **$0.002–0.008 per issue** (based on GPT-4o pricing as of 2025)

For a repository with 100 issues/month, expect roughly **$0.20–0.80/month**.

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Issue Pilot Contributors

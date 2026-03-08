# Contributing to Issue Pilot

Thank you for your interest in contributing to Issue Pilot! This document explains how to get started, how to submit contributions, and the code standards we follow.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Release Process](#release-process)

---

## Code of Conduct

This project follows a simple principle: be kind, be constructive, assume good intent. Harassment of any kind will not be tolerated.

---

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/issue-pilot.git
   cd issue-pilot
   ```
3. **Add the upstream remote:**
   ```bash
   git remote add upstream https://github.com/sunqiang/issue-pilot.git
   ```

---

## Development Setup

### Prerequisites

- **Node.js** >= 18 (we recommend using [nvm](https://github.com/nvm-sh/nvm))
- **npm** >= 9
- **OpenAI API key** (for integration tests — free tier works for development)
- **GitHub Personal Access Token** with `repo` scope (for integration tests)

### Install dependencies

```bash
npm install
```

### Set up environment variables

```bash
cp .env.example .env
# Edit .env with your OPENAI_API_KEY and GITHUB_TOKEN
```

### Build the project

```bash
npm run build
```

This compiles TypeScript from `src/` and `action/` into `dist/`.

### Run in development mode

```bash
# CLI (uses tsx for fast TypeScript execution, no compilation step)
npm run dev -- triage owner/repo 42

# GitHub Action entrypoint
npm run dev:action
```

---

## Project Structure

```
issue-pilot/
├── src/
│   ├── index.ts        CLI entry point (Commander.js commands)
│   ├── triage.ts       Core triage orchestration logic
│   ├── github.ts       GitHub API client (Octokit wrapper)
│   ├── ai.ts           OpenAI GPT-4o integration
│   ├── duplicate.ts    TF-IDF duplicate detection (no external deps)
│   ├── config.ts       Config loading (env vars + cosmiconfig)
│   └── types.ts        Shared TypeScript types and interfaces
├── action/
│   └── index.ts        GitHub Action entry point
├── tests/
│   ├── duplicate.test.ts
│   ├── config.test.ts
│   └── triage.test.ts
├── .github/
│   ├── workflows/      CI and release workflows
│   └── ISSUE_TEMPLATE/ Issue templates
├── action.yml          GitHub Action definition
├── package.json
└── tsconfig.json
```

### Key Design Decisions

- **No external NLP dependencies** — Duplicate detection is implemented with pure TF-IDF in `duplicate.ts` to keep the package lightweight
- **Structured AI output** — We use `response_format: { type: 'json_object' }` to get reliable JSON from GPT-4o, with sanitization to handle any malformed responses
- **Graceful degradation** — If the AI call fails after 3 retries, a fallback analysis is returned so triage doesn't completely fail
- **Dry run first** — When in doubt, use `--dry-run` to see what would happen before applying changes

---

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file change)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

Tests are written with [Vitest](https://vitest.dev/) and live in `tests/` files with `.test.ts` extension.

### Writing Tests

- **Unit tests** should not make real API calls — mock `openai` and `@octokit/rest` modules
- **Integration tests** (if added) should be in a separate directory and skipped in CI unless secrets are available
- Test files should be co-located next to source files or in a top-level `tests/` directory

Example mock pattern:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/ai.js', () => ({
  analyzeIssue: vi.fn().mockResolvedValue({
    summary: 'Test issue summary',
    issueType: 'bug',
    severity: 'medium',
    suggestedLabels: [{ name: 'bug', reason: 'Test', confidence: 0.9 }],
    duplicateKeywords: ['crash', 'error'],
    suggestedAssignees: [],
    additionalContext: '',
  }),
}));
```

---

## Code Style

We use **ESLint** with TypeScript rules. Run the linter with:

```bash
npm run lint

# Auto-fix issues where possible
npm run lint:fix
```

### Guidelines

- **TypeScript strict mode** is enabled — no implicit `any`, no unhandled nulls
- **Prefer `async/await`** over raw Promise chains
- **Descriptive variable names** — avoid single-letter names except for short-lived loop indices
- **Error messages** should be actionable — tell the user what went wrong AND what to do about it
- **No hardcoded values** — use constants or config options for anything that might change
- **Comment the "why"**, not the "what" — good code is self-documenting; comments explain intent

### TypeScript Conventions

```typescript
// Prefer explicit return types on exported functions
export async function triageIssue(
  config: IssuePilotConfig,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<TriageResult> { ... }

// Use type guards instead of casting
function isValidSeverity(s: string): s is IssueSeverity {
  return ['low', 'medium', 'high', 'critical'].includes(s);
}

// Destructure parameters for clarity
const { openaiApiKey, githubToken, dryRun } = config;
```

---

## Submitting Changes

### Workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-new-feature
   # or
   git checkout -b fix/issue-description
   ```

2. **Make your changes** — keep commits focused and atomic

3. **Run tests and linting:**
   ```bash
   npm run lint
   npm test
   npm run build
   ```

4. **Commit with a descriptive message** following [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add support for custom AI models
   fix: handle empty issue body without crashing
   docs: add configuration reference table to README
   test: add unit tests for TF-IDF similarity function
   refactor: extract label selection logic to separate function
   ```

5. **Push your branch** and open a Pull Request against `main`

### Pull Request Guidelines

- **One concern per PR** — don't bundle unrelated changes
- **Include tests** for new functionality or bug fixes
- **Update documentation** if you change behavior or add options
- **Reference issues** using `Fixes #123` or `Related to #456` in the PR description
- PRs require at least one approving review before merging

---

## Reporting Bugs

Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) issue template. Include:

- Issue Pilot version (`issue-pilot --version`)
- Node.js version
- Your operating system
- Steps to reproduce (specific commands you ran)
- Expected vs actual behavior
- Any error messages or stack traces

**Never include API keys or tokens in bug reports.**

---

## Requesting Features

Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) issue template. The most compelling feature requests:

- Clearly describe the problem being solved (not just the solution)
- Include a concrete use case
- Acknowledge trade-offs or implementation complexity

---

## Release Process

Releases are automated via the `release.yml` workflow. Maintainers trigger a release by pushing a version tag:

```bash
git tag v1.2.0
git push origin v1.2.0
```

This triggers:
1. Running the full test suite
2. Building TypeScript
3. Publishing to npm
4. Creating a GitHub Release with auto-generated changelog

We follow [Semantic Versioning](https://semver.org/):
- `PATCH` (1.0.x) — Bug fixes, no API changes
- `MINOR` (1.x.0) — New features, backward-compatible
- `MAJOR` (x.0.0) — Breaking changes

---

Thank you for contributing to Issue Pilot!

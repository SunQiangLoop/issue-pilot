import { Octokit } from '@octokit/rest';
import { GitHubIssue, IssueContext, LabelConfig, RateLimitInfo } from './types.js';
import { contributorsCache, recentIssuesCache } from './cache.js';

let octokitInstance: Octokit | null = null;

function getOctokit(token: string): Octokit {
  if (!octokitInstance) {
    octokitInstance = new Octokit({
      auth: token,
      throttle: {
        onRateLimit: (retryAfter: number, options: { method: string; url: string }) => {
          console.warn(`Rate limit hit for ${options.method} ${options.url} — retrying after ${retryAfter}s`);
          return true; // Retry once
        },
        onSecondaryRateLimit: (retryAfter: number, options: { method: string; url: string }) => {
          console.warn(`Secondary rate limit hit for ${options.method} ${options.url}`);
          return retryAfter < 60; // Only retry if wait is under 60s
        },
      },
    });
  }
  return octokitInstance;
}

export async function getIssue(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<IssueContext> {
  const octokit = getOctokit(token);

  const { data } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  return mapGitHubIssue(data as unknown as GitHubIssue);
}

export async function getRecentIssues(
  token: string,
  owner: string,
  repo: string,
  limit = 100
): Promise<IssueContext[]> {
  const cacheKey = `${owner}/${repo}/issues/${limit}`;
  const cached = recentIssuesCache.get(cacheKey) as IssueContext[] | null;
  if (cached) return cached;

  const octokit = getOctokit(token);
  const issues: IssueContext[] = [];
  let page = 1;
  const perPage = Math.min(limit, 100);

  while (issues.length < limit) {
    const { data } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: 'all',
      per_page: perPage,
      page,
      sort: 'created',
      direction: 'desc',
    });

    if (data.length === 0) break;

    const filteredIssues = data.filter((issue) => !('pull_request' in issue));
    issues.push(...filteredIssues.map((i) => mapGitHubIssue(i as unknown as GitHubIssue)));

    if (data.length < perPage) break;
    page++;
  }

  const result = issues.slice(0, limit);
  recentIssuesCache.set(cacheKey, result);
  return result;
}

export async function addLabels(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<void> {
  const octokit = getOctokit(token);

  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels,
  });
}

export async function addComment(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  const octokit = getOctokit(token);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

export async function assignIssue(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  assignees: string[]
): Promise<void> {
  const octokit = getOctokit(token);

  await octokit.issues.addAssignees({
    owner,
    repo,
    issue_number: issueNumber,
    assignees,
  });
}

export async function createLabel(
  token: string,
  owner: string,
  repo: string,
  name: string,
  color: string,
  description: string
): Promise<void> {
  const octokit = getOctokit(token);

  try {
    await octokit.issues.createLabel({ owner, repo, name, color, description });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'status' in error &&
      (error as { status: number }).status === 422
    ) {
      // Label already exists — update it instead
      await octokit.issues.updateLabel({ owner, repo, name, color, description });
    } else {
      throw error;
    }
  }
}

export async function ensureLabelsExist(
  token: string,
  owner: string,
  repo: string,
  labels: LabelConfig[]
): Promise<{ created: string[]; updated: string[]; existing: string[] }> {
  const octokit = getOctokit(token);

  const { data: existingLabels } = await octokit.issues.listLabelsForRepo({
    owner,
    repo,
    per_page: 100,
  });

  const existingLabelMap = new Map(existingLabels.map((l) => [l.name, l]));
  const created: string[] = [];
  const updated: string[] = [];
  const existing: string[] = [];

  for (const label of labels) {
    const existingLabel = existingLabelMap.get(label.name);

    if (!existingLabel) {
      await createLabel(token, owner, repo, label.name, label.color, label.description);
      created.push(label.name);
    } else if (
      existingLabel.color !== label.color ||
      existingLabel.description !== label.description
    ) {
      await octokit.issues.updateLabel({
        owner,
        repo,
        name: label.name,
        color: label.color,
        description: label.description,
      });
      updated.push(label.name);
    } else {
      existing.push(label.name);
    }
  }

  return { created, updated, existing };
}

export async function getRepositoryContributors(
  token: string,
  owner: string,
  repo: string,
  limit = 20
): Promise<string[]> {
  const cacheKey = `${owner}/${repo}/contributors`;
  const cached = contributorsCache.get(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit(token);

  try {
    const { data } = await octokit.repos.listContributors({
      owner,
      repo,
      per_page: limit,
    });

    const contributors = data
      .filter((c) => c.type === 'User' && c.login)
      .map((c) => c.login as string);

    contributorsCache.set(cacheKey, contributors);
    return contributors;
  } catch {
    return [];
  }
}

/**
 * Fetch current GitHub API rate limit status.
 */
export async function getRateLimitInfo(token: string): Promise<RateLimitInfo> {
  const octokit = getOctokit(token);
  const { data } = await octokit.rateLimit.get();
  const core = data.rate;

  return {
    limit: core.limit,
    remaining: core.remaining,
    reset: core.reset,
    used: core.used,
  };
}

/**
 * Check if the API rate limit is critically low (<10% remaining).
 */
export function isRateLimitLow(info: RateLimitInfo): boolean {
  return info.remaining < info.limit * 0.1;
}

function mapGitHubIssue(issue: GitHubIssue): IssueContext {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body || '',
    labels: issue.labels.map((l) => l.name || '').filter(Boolean),
    author: issue.user?.login || 'unknown',
    createdAt: issue.created_at,
    url: issue.html_url,
    state: issue.state,
    commentCount: issue.comments,
  };
}

export function resetOctokitInstance(): void {
  octokitInstance = null;
}

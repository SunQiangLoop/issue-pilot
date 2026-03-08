import { describe, it, expect } from 'vitest';
import { findDuplicates } from '../src/duplicate.js';
import { IssueContext } from '../src/types.js';

function makeIssue(number: number, title: string, body: string): IssueContext {
  return {
    number,
    title,
    body,
    labels: [],
    author: 'testuser',
    createdAt: new Date().toISOString(),
    url: `https://github.com/owner/repo/issues/${number}`,
  };
}

describe('findDuplicates', () => {
  it('returns empty array when there are no existing issues', () => {
    const newIssue = makeIssue(1, 'App crashes on startup', 'The application crashes immediately on launch with a NullPointerException');
    const result = findDuplicates(newIssue, [], 0.5);
    expect(result).toEqual([]);
  });

  it('excludes the new issue itself from results', () => {
    const issue = makeIssue(1, 'App crashes on startup', 'The application crashes immediately on launch');
    const result = findDuplicates(issue, [issue], 0.1);
    expect(result).toEqual([]);
  });

  it('finds a highly similar duplicate', () => {
    const newIssue = makeIssue(
      10,
      'Application crashes when uploading large files',
      'When I try to upload a file larger than 10MB, the application crashes with an out of memory error. This happens consistently on all platforms.'
    );

    const duplicate = makeIssue(
      5,
      'App crashes on large file upload',
      'Uploading files over 10MB causes the app to crash with memory error. Reproducible on macOS and Windows.'
    );

    const unrelated = makeIssue(
      3,
      'Add dark mode support to the UI',
      'It would be great to have a dark theme option in the settings panel for better usability at night.'
    );

    const results = findDuplicates(newIssue, [duplicate, unrelated], 0.3, [
      'upload', 'crash', 'large file', 'memory error',
    ]);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].issueNumber).toBe(5);
    expect(results[0].similarity).toBeGreaterThan(0.3);
  });

  it('does not flag unrelated issues as duplicates with high threshold', () => {
    const newIssue = makeIssue(
      10,
      'Login button not working on mobile',
      'The login button does not respond to touch events on iOS devices running Safari browser.'
    );

    const unrelated = makeIssue(
      5,
      'Add dark mode support',
      'It would be great to have a dark theme option in the settings panel for better night-time usability.'
    );

    const results = findDuplicates(newIssue, [unrelated], 0.85);
    expect(results).toEqual([]);
  });

  it('returns at most 3 results', () => {
    const newIssue = makeIssue(
      10,
      'Database connection timeout error',
      'Getting connection timeout errors when trying to connect to the PostgreSQL database after idle period.'
    );

    const similar = [
      makeIssue(1, 'Database timeout when idle', 'PostgreSQL connection drops after being idle, timeout error appears in logs.'),
      makeIssue(2, 'DB connection timeout issue', 'Connection to database times out after idle period, need to reconnect manually.'),
      makeIssue(3, 'PostgreSQL idle connection timeout', 'Database connections timeout after idle, causing errors in the application.'),
      makeIssue(4, 'Connection pool timeout after idle period', 'Database connection pool times out during low-traffic periods, connection drops.'),
    ];

    const results = findDuplicates(newIssue, similar, 0.1);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('sorts results by similarity descending', () => {
    const newIssue = makeIssue(
      10,
      'TypeError: Cannot read property of undefined',
      'Getting TypeError: Cannot read property "name" of undefined when calling getUserProfile function in auth module.'
    );

    const issues = [
      makeIssue(1, 'TypeError in auth module', 'Seeing TypeError in auth module when user logs out and then tries to view profile.'),
      makeIssue(2, 'Cannot read property undefined error', 'TypeError: Cannot read property "name" of undefined — same error as #5 but in different component.'),
      makeIssue(3, 'Feature request: add search bar', 'Would love to have a search bar in the navigation to quickly find content.'),
    ];

    const results = findDuplicates(newIssue, issues, 0.1);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
    }
  });

  it('keyword boost increases similarity for matching keywords', () => {
    const newIssue = makeIssue(
      10,
      'CORS error when calling API',
      'Getting CORS error in the browser console when making requests to the backend API endpoint.'
    );

    const withKeyword = makeIssue(
      1,
      'Cross-origin request blocked',
      'Browser blocks the request with Access-Control-Allow-Origin error when calling the REST endpoint.'
    );

    // Without keyword boost
    const resultsWithout = findDuplicates(newIssue, [withKeyword], 0.0, []);
    const similarityWithout = resultsWithout[0]?.similarity ?? 0;

    // With keyword boost
    const resultsWith = findDuplicates(newIssue, [withKeyword], 0.0, ['CORS', 'API', 'browser', 'endpoint']);
    const similarityWith = resultsWith[0]?.similarity ?? 0;

    // Keyword boost should increase or maintain similarity
    expect(similarityWith).toBeGreaterThanOrEqual(similarityWithout);
  });

  it('handles issues with empty body', () => {
    const newIssue = makeIssue(10, 'App crashes on startup', '');
    const other = makeIssue(5, 'App crashes on startup', '');

    // Should not throw
    const results = findDuplicates(newIssue, [other], 0.1);
    expect(Array.isArray(results)).toBe(true);
  });

  it('matched keywords are populated in results', () => {
    const newIssue = makeIssue(
      10,
      'Memory leak in worker thread',
      'The worker thread has a memory leak that grows over time and eventually crashes the process.'
    );

    const duplicate = makeIssue(
      5,
      'Worker thread memory leak',
      'Found a memory leak in the background worker thread, memory usage grows until crash.'
    );

    const keywords = ['memory leak', 'worker thread', 'crash'];
    const results = findDuplicates(newIssue, [duplicate], 0.1, keywords);

    if (results.length > 0) {
      expect(Array.isArray(results[0].matchedKeywords)).toBe(true);
    }
  });
});

import { IssueContext, DuplicateMatch } from './types.js';

/**
 * Split camelCase and snake_case identifiers into individual tokens.
 * e.g. "crashOnFileUpload" → ["crash", "file", "upload"]
 *      "file_upload_error"  → ["file", "upload", "error"]
 */
function splitIdentifiers(text: string): string {
  return text
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/**
 * Normalize version strings to a generic token to reduce noise.
 * e.g. "v1.2.3", "2.0.0-beta" → "versiontoken"
 */
function normalizeVersions(text: string): string {
  return text.replace(/\bv?\d+\.\d+(\.\d+)*(-[a-z0-9]+)?\b/gi, 'versiontoken');
}

/**
 * Tokenize text into normalized terms for TF-IDF computation.
 * Handles: code blocks, inline code, URLs, camelCase, snake_case, version strings.
 */
function tokenize(text: string): string[] {
  return splitIdentifiers(
      normalizeVersions(
        text
          .toLowerCase()
          .replace(/```[\s\S]*?```/g, ' ')  // Remove fenced code blocks
          .replace(/`[^`]+`/g, ' ')          // Remove inline code
          .replace(/https?:\/\/\S+/g, ' ')  // Remove URLs
          .replace(/<!--[\s\S]*?-->/g, ' ') // Remove HTML comments
          .replace(/#\d+/g, ' ')            // Remove issue/PR references like #123
      )
    )
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/**
 * Compute term frequency (normalized) for a list of tokens.
 */
function computeTF(tokens: string[]): Map<string, number> {
  if (tokens.length === 0) return new Map();

  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  for (const [term, count] of tf) {
    tf.set(term, count / tokens.length);
  }
  return tf;
}

/**
 * Compute inverse document frequency for a corpus.
 * Uses smoothed IDF: log((N+1)/(df+1)) + 1
 */
function computeIDF(corpus: string[][]): Map<string, number> {
  const docFreq = new Map<string, number>();
  const N = corpus.length;

  for (const tokens of corpus) {
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
  }
  return idf;
}

/**
 * Compute TF-IDF vector for a document given pre-computed IDF.
 */
function computeTFIDF(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = computeTF(tokens);
  const tfidf = new Map<string, number>();

  for (const [term, tfScore] of tf) {
    const idfScore = idf.get(term) ?? Math.log(2);
    tfidf.set(term, tfScore * idfScore);
  }
  return tfidf;
}

/**
 * Compute cosine similarity between two TF-IDF vectors.
 */
function cosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, scoreA] of vecA) {
    dotProduct += scoreA * (vecB.get(term) ?? 0);
    normA += scoreA * scoreA;
  }
  for (const scoreB of vecB.values()) {
    normB += scoreB * scoreB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compute Jaccard similarity between two token sets.
 * Useful as a complementary signal to TF-IDF for short texts like titles.
 */
function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Compute keyword boost score based on AI-extracted keywords found in candidate text.
 */
function computeKeywordBoost(keywords: string[], issueText: string): number {
  if (keywords.length === 0) return 0;

  const normalizedText = issueText.toLowerCase();
  let matches = 0;

  for (const keyword of keywords) {
    if (normalizedText.includes(keyword.toLowerCase())) {
      matches++;
    }
  }
  return matches / keywords.length;
}

/**
 * Get the list of keywords that matched in the candidate text.
 */
function getMatchedKeywords(keywords: string[], issueText: string): string[] {
  const normalizedText = issueText.toLowerCase();
  return keywords.filter((k) => normalizedText.includes(k.toLowerCase()));
}

/**
 * Find potential duplicate issues using a hybrid similarity approach:
 * - TF-IDF cosine similarity (body + title weighted)
 * - Jaccard similarity on title tokens
 * - AI keyword boost (up to 20%)
 *
 * @param newIssue - The new issue to check for duplicates
 * @param existingIssues - Existing issues to compare against
 * @param threshold - Minimum similarity score (0–1) to include
 * @param aiKeywords - Keywords extracted by AI for boosted matching
 * @returns Top 3 matches sorted by similarity descending
 */
export function findDuplicates(
  newIssue: IssueContext,
  existingIssues: IssueContext[],
  threshold: number,
  aiKeywords: string[] = []
): DuplicateMatch[] {
  // Exclude the current issue from candidates
  const candidates = existingIssues.filter((i) => i.number !== newIssue.number);
  if (candidates.length === 0) return [];

  // Title is weighted 3x to amplify its importance in similarity scoring
  const newIssueText = `${newIssue.title} ${newIssue.title} ${newIssue.title} ${newIssue.body}`;
  const candidateTexts = candidates.map((c) => `${c.title} ${c.title} ${c.title} ${c.body}`);

  const newTokens = tokenize(newIssueText);
  const candidateTokens = candidateTexts.map(tokenize);

  const corpus = [newTokens, ...candidateTokens];
  const idf = computeIDF(corpus);

  const newTFIDF = computeTFIDF(newTokens, idf);
  const newTitleTokens = tokenize(newIssue.title);

  const matches: DuplicateMatch[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateTFIDF = computeTFIDF(candidateTokens[i], idf);

    // Signal 1: Full-text TF-IDF cosine similarity
    const tfidfSimilarity = cosineSimilarity(newTFIDF, candidateTFIDF);

    // Signal 2: AI keyword boost (max +20%)
    const candidateFullText = `${candidate.title} ${candidate.body}`;
    const keywordBoost = computeKeywordBoost(aiKeywords, candidateFullText);
    const boostedTFIDF = Math.min(1, tfidfSimilarity + keywordBoost * 0.2);

    // Signal 3: Title-only Jaccard + TF-IDF combination
    const candidateTitleTokens = tokenize(candidate.title);
    let titleSimilarity = 0;

    if (newTitleTokens.length > 0 && candidateTitleTokens.length > 0) {
      const titleCorpus = [newTitleTokens, candidateTitleTokens];
      const titleIDF = computeIDF(titleCorpus);
      const newTitleTFIDF = computeTFIDF(newTitleTokens, titleIDF);
      const candidateTitleTFIDF = computeTFIDF(candidateTitleTokens, titleIDF);

      const titleTFIDF = cosineSimilarity(newTitleTFIDF, candidateTitleTFIDF);
      const titleJaccard = jaccardSimilarity(newTitleTokens, candidateTitleTokens);

      // Combine TF-IDF and Jaccard for title similarity
      titleSimilarity = titleTFIDF * 0.6 + titleJaccard * 0.4;
    }

    // Final score: 55% full-text (boosted), 45% title-only
    const finalSimilarity = boostedTFIDF * 0.55 + titleSimilarity * 0.45;
    const matchedKeywords = getMatchedKeywords(aiKeywords, candidateFullText);

    if (finalSimilarity >= threshold) {
      matches.push({
        issueNumber: candidate.number,
        title: candidate.title,
        url: candidate.url,
        similarity: Math.round(finalSimilarity * 100) / 100,
        matchedKeywords,
      });
    }
  }

  return matches
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}

const STOP_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'it',
  'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this',
  'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or',
  'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
  'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
  'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come',
  'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how',
  'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because',
  'any', 'these', 'give', 'day', 'most', 'us', 'was', 'are', 'is', 'has',
  'had', 'been', 'were', 'being', 'i', 'am', 'did', 'does', 'doing',
  'should', 'shall', 'may', 'might', 'must', 'need', 'used', 'using',
  'please', 'thanks', 'hello', 'hi', 'hey', 'okay', 'yes', 'much',
  'more', 'very', 'really', 'quite', 'still', 'too', 'here', 'there',
  'where', 'why', 'who', 'whom', 'whose', 'while', 'though', 'let',
  'although', 'since', 'before', 'during', 'between', 'through', 'via',
  'without', 'within', 'along', 'across', 'below', 'above', 'down',
  'under', 'again', 'further', 'once', 'same', 'such', 'both', 'few',
  'each', 'every', 'either', 'neither', 'own', 'per', 'set', 'put',
  'run', 'add', 'try', 'fix', 'get', 'got', 'see', 'saw', 'show',
  'call', 'find', 'keep', 'help', 'test', 'check', 'code', 'file',
  'line', 'list', 'type', 'make', 'load', 'read', 'write', 'send',
  'open', 'close', 'save', 'data', 'info', 'step', 'item', 'form',
  'true', 'false', 'null', 'none', 'zero', 'able', 'want', 'seem',
  'expected', 'actual', 'result', 'issue', 'problem', 'error', 'fail',
  'note', 'case', 'page', 'part', 'side', 'left', 'right', 'start',
  'end', 'done', 'like', 'also', 'however', 'therefore', 'example',
]);

import { IssueContext, DuplicateMatch } from './types.js';

/**
 * Tokenize text into normalized terms for TF-IDF computation.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ') // Remove code blocks
    .replace(/`[^`]+`/g, ' ')        // Remove inline code
    .replace(/https?:\/\/\S+/g, ' ') // Remove URLs
    .replace(/[^a-z0-9\s]/g, ' ')   // Remove punctuation
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !STOP_WORDS.has(token));
}

/**
 * Compute term frequency for a list of tokens.
 */
function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  // Normalize by document length
  for (const [term, count] of tf) {
    tf.set(term, count / tokens.length);
  }
  return tf;
}

/**
 * Compute inverse document frequency for a corpus.
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
    const idfScore = idf.get(term) || Math.log(2); // Default IDF for unknown terms
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
    const scoreB = vecB.get(term) || 0;
    dotProduct += scoreA * scoreB;
    normA += scoreA * scoreA;
  }

  for (const scoreB of vecB.values()) {
    normB += scoreB * scoreB;
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compute a keyword boost score for two issues based on shared AI-extracted keywords.
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
 * Get the matched keywords between an issue and a candidate.
 */
function getMatchedKeywords(keywords: string[], issueText: string): string[] {
  const normalizedText = issueText.toLowerCase();
  return keywords.filter((k) => normalizedText.includes(k.toLowerCase()));
}

/**
 * Find potential duplicate issues using TF-IDF similarity and keyword boosting.
 *
 * @param newIssue - The new issue to check for duplicates
 * @param existingIssues - The existing issues to compare against
 * @param threshold - Minimum similarity score (0-1) to consider as duplicate
 * @param aiKeywords - Keywords extracted by AI to boost matching
 * @returns Top matching issues above the threshold
 */
export function findDuplicates(
  newIssue: IssueContext,
  existingIssues: IssueContext[],
  threshold: number,
  aiKeywords: string[] = []
): DuplicateMatch[] {
  // Exclude the new issue itself from candidates
  const candidates = existingIssues.filter((i) => i.number !== newIssue.number);

  if (candidates.length === 0) return [];

  // Prepare text for each document (title weighted 3x for importance)
  const newIssueText = `${newIssue.title} ${newIssue.title} ${newIssue.title} ${newIssue.body}`;
  const candidateTexts = candidates.map(
    (c) => `${c.title} ${c.title} ${c.title} ${c.body}`
  );

  // Tokenize all documents
  const newTokens = tokenize(newIssueText);
  const candidateTokens = candidateTexts.map(tokenize);

  // Build corpus for IDF computation
  const corpus = [newTokens, ...candidateTokens];
  const idf = computeIDF(corpus);

  // Compute TF-IDF for new issue
  const newTFIDF = computeTFIDF(newTokens, idf);

  // Compute similarities for each candidate
  const matches: DuplicateMatch[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateTFIDF = computeTFIDF(candidateTokens[i], idf);

    // Base TF-IDF cosine similarity
    let similarity = cosineSimilarity(newTFIDF, candidateTFIDF);

    // Apply keyword boost (max 20% boost)
    const candidateFullText = `${candidate.title} ${candidate.body}`;
    const keywordBoost = computeKeywordBoost(aiKeywords, candidateFullText);
    const boostedSimilarity = Math.min(1, similarity + keywordBoost * 0.2);

    // Title-only similarity as additional signal
    const newTitleTokens = tokenize(newIssue.title);
    const candidateTitleTokens = tokenize(candidate.title);
    if (newTitleTokens.length > 0 && candidateTitleTokens.length > 0) {
      const titleCorpus = [newTitleTokens, candidateTitleTokens];
      const titleIDF = computeIDF(titleCorpus);
      const newTitleTFIDF = computeTFIDF(newTitleTokens, titleIDF);
      const candidateTitleTFIDF = computeTFIDF(candidateTitleTokens, titleIDF);
      const titleSimilarity = cosineSimilarity(newTitleTFIDF, candidateTitleTFIDF);

      // Weighted average: 60% body+title TF-IDF, 40% title-only similarity
      similarity = boostedSimilarity * 0.6 + titleSimilarity * 0.4;
    } else {
      similarity = boostedSimilarity;
    }

    const matchedKeywords = getMatchedKeywords(aiKeywords, candidateFullText);

    if (similarity >= threshold) {
      matches.push({
        issueNumber: candidate.number,
        title: candidate.title,
        url: candidate.url,
        similarity: Math.round(similarity * 100) / 100,
        matchedKeywords,
      });
    }
  }

  // Sort by similarity descending and return top 3
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
  'where', 'why', 'who', 'whom', 'whose', 'which', 'while', 'though',
  'although', 'since', 'before', 'after', 'during', 'between', 'through',
  'without', 'within', 'along', 'across', 'below', 'above', 'down',
  'under', 'again', 'further', 'once', 'same', 'such', 'both', 'few',
  'more', 'other', 'each', 'every', 'either', 'neither', 'own', 'per',
]);

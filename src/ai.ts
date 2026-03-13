import OpenAI from 'openai';
import { AIAnalysis, IssuePilotConfig, LabelConfig, TokenUsage } from './types.js';

let openaiClient: OpenAI | null = null;

// GPT-4o pricing per 1K tokens (as of 2025)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o':      { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
};

function getOpenAIClient(apiKey: string): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o'];
  return (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output;
}

const SYSTEM_PROMPT = `You are an expert GitHub issue triage assistant with deep knowledge of software development workflows. Your job is to analyze GitHub issues and provide structured triage information to help maintainers manage their project efficiently.

When analyzing issues, you should:
1. Carefully read the title and body to understand the root problem or request
2. Identify the type of issue (bug, feature, question, docs, security, or other)
3. Assess the severity based on impact, urgency, and scope of users affected
4. Suggest appropriate labels from the provided label list with confidence scores
5. Generate a concise one-sentence summary that captures the essence of the issue
6. Extract specific technical keywords to identify potential duplicates
7. Suggest potential assignees only if explicitly mentioned or patterns are clear

Severity assessment guidelines:
- critical: Data loss, security breach, complete system failure, production outage affecting all users
- high: Major functionality broken, significant user impact, no reasonable workaround exists
- medium: Partial functionality affected, workaround is available but cumbersome
- low: Minor cosmetic issue, nice-to-have improvement, edge case with minimal user impact

Your response must always be valid JSON matching the exact schema provided.`;

function buildUserPrompt(
  title: string,
  body: string,
  availableLabels: LabelConfig[]
): string {
  const labelsDescription = availableLabels
    .map((l) => `  - "${l.name}": ${l.description}`)
    .join('\n');

  const truncatedBody = body.length > 4000 ? body.slice(0, 4000) + '\n...[truncated]' : body;

  return `Analyze this GitHub issue and provide a structured triage response.

## Issue Title
${title}

## Issue Body
${truncatedBody || '(No description provided)'}

## Available Labels
${labelsDescription}

## Required Response Format
Respond with a JSON object exactly matching this schema:
{
  "summary": "One concise sentence (max 150 chars) describing what this issue is about",
  "issueType": "bug" | "feature" | "question" | "docs" | "security" | "other",
  "severity": "low" | "medium" | "high" | "critical",
  "suggestedLabels": [
    {
      "name": "exact label name from available labels",
      "reason": "brief reason why this label applies",
      "confidence": 0.0-1.0
    }
  ],
  "duplicateKeywords": ["keyword1", "keyword2"],
  "suggestedAssignees": [],
  "additionalContext": "Any important context, missing info requests, or next steps (empty string if none)"
}

## Notes
- Only suggest labels that exist exactly in the available labels list
- duplicateKeywords: 5-10 specific technical terms, error messages, or component names unique to this issue
- Confidence >= 0.7 means you are quite confident the label applies
- summary must be under 150 characters and actionable
- suggestedAssignees should be empty unless the issue explicitly mentions someone or a clear pattern exists
- additionalContext: mention if critical information is missing (e.g., no reproduction steps, no version info)`;
}

export interface AnalyzeResult {
  analysis: AIAnalysis;
  tokenUsage: TokenUsage;
}

export async function analyzeIssue(
  title: string,
  body: string,
  config: IssuePilotConfig
): Promise<AIAnalysis> {
  const { analysis } = await analyzeIssueWithUsage(title, body, config);
  return analysis;
}

export async function analyzeIssueWithUsage(
  title: string,
  body: string,
  config: IssuePilotConfig
): Promise<AnalyzeResult> {
  const client = getOpenAIClient(config.openaiApiKey);
  const model = config.model || 'gpt-4o';
  const userPrompt = buildUserPrompt(title, body, config.labels);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1200,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI API');
      }

      const parsed = JSON.parse(content) as AIAnalysis;
      const analysis = sanitizeAIResponse(parsed, config.labels);

      const usage = response.usage;
      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;

      const tokenUsage: TokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUSD: estimateCost(model, promptTokens, completionTokens),
      };

      return { analysis, tokenUsage };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < 3) {
        const delayMs = attempt * 1500;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error(`AI analysis failed after 3 attempts: ${lastError?.message}`);
  return {
    analysis: getFallbackAnalysis(title, body),
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
  };
}

function sanitizeAIResponse(parsed: Partial<AIAnalysis>, availableLabels: LabelConfig[]): AIAnalysis {
  const availableLabelNames = new Set(availableLabels.map((l) => l.name));

  const validSeverities = ['low', 'medium', 'high', 'critical'];
  const validTypes = ['bug', 'feature', 'question', 'docs', 'security', 'other'];

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 150) : 'Issue requires triage',
    issueType: validTypes.includes(parsed.issueType as string)
      ? parsed.issueType!
      : 'other',
    severity: validSeverities.includes(parsed.severity as string)
      ? parsed.severity!
      : 'medium',
    suggestedLabels: Array.isArray(parsed.suggestedLabels)
      ? parsed.suggestedLabels
          .filter(
            (l) =>
              l &&
              typeof l.name === 'string' &&
              availableLabelNames.has(l.name) &&
              typeof l.confidence === 'number'
          )
          .map((l) => ({
            name: l.name,
            reason: typeof l.reason === 'string' ? l.reason : '',
            confidence: Math.max(0, Math.min(1, l.confidence)),
          }))
      : [],
    duplicateKeywords: Array.isArray(parsed.duplicateKeywords)
      ? parsed.duplicateKeywords
          .filter((k) => typeof k === 'string' && k.trim().length > 0)
          .slice(0, 10)
      : [],
    suggestedAssignees: Array.isArray(parsed.suggestedAssignees)
      ? parsed.suggestedAssignees.filter((a) => typeof a === 'string')
      : [],
    additionalContext: typeof parsed.additionalContext === 'string' ? parsed.additionalContext : '',
  };
}

function getFallbackAnalysis(title: string, _body: string): AIAnalysis {
  // Extract meaningful keywords from the title for basic duplicate detection
  const keywords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8);

  return {
    summary: `Issue: ${title.slice(0, 120)}`,
    issueType: 'other',
    severity: 'medium',
    suggestedLabels: [],
    duplicateKeywords: keywords,
    suggestedAssignees: [],
    additionalContext: 'Automated AI analysis was unavailable. Manual triage required.',
  };
}

export function resetOpenAIClient(): void {
  openaiClient = null;
}

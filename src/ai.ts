import OpenAI from 'openai';
import { AIAnalysis, IssuePilotConfig, LabelConfig } from './types.js';

let openaiClient: OpenAI | null = null;

function getOpenAIClient(apiKey: string): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

const SYSTEM_PROMPT = `You are an expert GitHub issue triage assistant. Your job is to analyze GitHub issues and provide structured triage information to help maintainers manage their project efficiently.

When analyzing issues, you should:
1. Carefully read the title and body to understand the problem or request
2. Identify the type of issue (bug, feature, question, docs, security, or other)
3. Assess the severity based on impact and urgency
4. Suggest appropriate labels from the provided label list
5. Generate a concise one-sentence summary
6. Extract keywords that could help identify duplicate issues
7. Suggest potential assignees if patterns are recognizable

Your response must always be valid JSON matching the exact schema provided.`;

function buildUserPrompt(
  title: string,
  body: string,
  availableLabels: LabelConfig[]
): string {
  const labelsDescription = availableLabels
    .map((l) => `  - "${l.name}": ${l.description}`)
    .join('\n');

  return `Analyze this GitHub issue and provide a structured triage response.

## Issue Title
${title}

## Issue Body
${body || '(No description provided)'}

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
  "duplicateKeywords": ["keyword1", "keyword2", ...],
  "suggestedAssignees": [],
  "additionalContext": "Any important context, missing info requests, or next steps (optional)"
}

## Severity Guidelines
- critical: Data loss, security breach, system down, production outage
- high: Major functionality broken, significant user impact, no workaround
- medium: Partial functionality affected, workaround exists
- low: Minor issue, cosmetic, nice-to-have improvement

## Notes
- Only suggest labels that exist in the available labels list
- duplicateKeywords should be specific technical terms or error messages that would uniquely identify this issue (5-10 keywords)
- Confidence should reflect how certain you are the label applies (0.7+ means quite confident)
- Keep summary under 150 characters
- additionalContext should be empty string if no additional context needed`;
}

export async function analyzeIssue(
  title: string,
  body: string,
  config: IssuePilotConfig
): Promise<AIAnalysis> {
  const client = getOpenAIClient(config.openaiApiKey);

  const userPrompt = buildUserPrompt(title, body, config.labels);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI API');
      }

      const parsed = JSON.parse(content) as AIAnalysis;

      // Validate and sanitize the response
      return sanitizeAIResponse(parsed, config.labels);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < 3) {
        // Wait before retry with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  // Return a fallback analysis if AI fails
  console.error(`AI analysis failed after 3 attempts: ${lastError?.message}`);
  return getFallbackAnalysis(title, body);
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
      ? parsed.duplicateKeywords.filter((k) => typeof k === 'string').slice(0, 10)
      : [],
    suggestedAssignees: Array.isArray(parsed.suggestedAssignees)
      ? parsed.suggestedAssignees.filter((a) => typeof a === 'string')
      : [],
    additionalContext: typeof parsed.additionalContext === 'string' ? parsed.additionalContext : '',
  };
}

function getFallbackAnalysis(title: string, _body: string): AIAnalysis {
  return {
    summary: `Issue: ${title.slice(0, 100)}`,
    issueType: 'other',
    severity: 'medium',
    suggestedLabels: [],
    duplicateKeywords: title
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5),
    suggestedAssignees: [],
    additionalContext: 'Automated AI analysis was unavailable. Manual triage required.',
  };
}

export function resetOpenAIClient(): void {
  openaiClient = null;
}

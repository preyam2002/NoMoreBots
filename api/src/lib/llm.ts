import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { ADVANCED_FILTERS } from "@shared/filters";
import { env } from "./env";
import { ExternalServiceError, handleError } from "./errors";

export type LLMProvider = "openai" | "gemini" | "anthropic";
export interface ClassificationPromptContext {
  context?: string;
  quotedText?: string;
  mediaSummary?: string;
  isReply?: boolean;
  platform?: string;
}

const openai = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    })
  : null;

const gemini = env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(env.GEMINI_API_KEY)
  : null;

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

const CATEGORY_LIST = ADVANCED_FILTERS.map((filter) => `'${filter.category}'`).join(" | ");
const CATEGORY_GUIDANCE = ADVANCED_FILTERS.map(
  (filter) => `${filter.category}: ${filter.promptHint}`
).join(". ");

const SYSTEM_PROMPT =
  `Analyze the tweet. Respond JSON: { ai_probability: 0-1, category: 'normal' | ${CATEGORY_LIST}, reason: string }. ` +
  `${CATEGORY_GUIDANCE}. If no special moderation category applies, return 'normal'.`;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, provider: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ExternalServiceError(provider, `Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race<T>([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function normalizePromptText(value?: string) {
  return value?.replace(/\s+/g, " ").trim();
}

export function buildClassificationPrompt(
  text: string,
  contextOrMetadata?: string | ClassificationPromptContext
) {
  const metadata =
    typeof contextOrMetadata === "string"
      ? { context: contextOrMetadata }
      : contextOrMetadata || {};

  const parts = [
    `Post text: "${normalizePromptText(text) || "[No visible text]"}"`,
  ];

  if (metadata.isReply) {
    parts.push("Reply signal: this post appears to be a reply in an active conversation.");
  }

  if (metadata.context) {
    parts.push(`Parent conversation context: "${normalizePromptText(metadata.context)}"`);
  }

  if (metadata.quotedText) {
    parts.push(`Quoted post text: "${normalizePromptText(metadata.quotedText)}"`);
  }

  if (metadata.mediaSummary) {
    parts.push(`Attached media summary: "${normalizePromptText(metadata.mediaSummary)}"`);
  }

  if (metadata.platform) {
    parts.push(`Platform: ${metadata.platform}`);
  }

  parts.push(
    "Classify the visible post itself. Use parent, quote, and media details only as supporting context."
  );

  return parts.join("\n\n");
}

async function classifyWithOpenAI(content: string, apiKey?: string) {
  const client = apiKey ? new OpenAI({ apiKey }) : openai;
  if (!client) throw new ExternalServiceError("OpenAI", "API key not configured");

  try {
    const completion = await client.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: content },
      ],
      model: "gpt-3.5-turbo",
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const responseContent = completion.choices[0]?.message?.content;
    if (!responseContent) throw new ExternalServiceError("OpenAI", "No content received");

    return JSON.parse(responseContent);
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;
    throw new ExternalServiceError("OpenAI", error instanceof Error ? error.message : "Unknown error");
  }
}

async function classifyWithGemini(content: string, apiKey?: string) {
  const key = apiKey || env.GEMINI_API_KEY;
  if (!key) throw new ExternalServiceError("Gemini", "API key not configured");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${content}` }] }],
          generationConfig: { temperature: 0.3 },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new ExternalServiceError("Gemini", `API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new ExternalServiceError("Gemini", "Invalid JSON response");

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;
    throw new ExternalServiceError("Gemini", error instanceof Error ? error.message : "Unknown error");
  }
}

async function classifyWithAnthropic(content: string, apiKey?: string) {
  const client = apiKey ? new Anthropic({ apiKey }) : anthropic;
  if (!client) throw new ExternalServiceError("Anthropic", "API key not configured");

  try {
    const message = await client.messages.create({
      max_tokens: 1024,
      messages: [{ role: "user", content: `${SYSTEM_PROMPT}\n\n${content}` }],
      model: "claude-3-opus-20240229",
    });

    const responseContent =
      message.content[0]?.type === "text" ? message.content[0].text : "";
    if (!responseContent) throw new ExternalServiceError("Anthropic", "No content received");

    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new ExternalServiceError("Anthropic", "Invalid JSON response");

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;
    throw new ExternalServiceError("Anthropic", error instanceof Error ? error.message : "Unknown error");
  }
}

export async function classifyTweet(
  text: string,
  apiKey?: string,
  provider: LLMProvider | string = "gemini",
  contextOrMetadata?: string | ClassificationPromptContext
): Promise<{ aiProbability: number; category: string; reason: string }> {
  const prompt = buildClassificationPrompt(text, contextOrMetadata);
  const timeoutMs = env.AI_PROVIDER_TIMEOUT_MS;

  try {
    let result;
    switch (provider) {
      case "gemini":
        result = await withTimeout(classifyWithGemini(prompt, apiKey), timeoutMs, "Gemini");
        break;
      case "anthropic":
        result = await withTimeout(classifyWithAnthropic(prompt, apiKey), timeoutMs, "Anthropic");
        break;
      case "openai":
      default:
        result = await withTimeout(classifyWithOpenAI(prompt, apiKey), timeoutMs, "OpenAI");
    }

    return {
      aiProbability: result.ai_probability ?? result.aiProbability ?? 0,
      category: result.category || "normal",
      reason: result.reason ?? "No reason provided",
    };
  } catch (error) {
    const handled = handleError(error);
    console.error(`LLM Classification Error (${provider}):`, handled.message);

    return {
      aiProbability: 0,
      category: "normal",
      reason: "Classification unavailable",
    };
  }
}

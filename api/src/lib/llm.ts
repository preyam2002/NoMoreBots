import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

export type LLMProvider = "openai" | "gemini" | "anthropic";

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

const SYSTEM_PROMPT =
  "Analyze the tweet. Respond JSON: { ai_probability: 0-1, category: 'normal' | 'engagement_farming' | 'ragebait' | 'hate_speech', reason: string }. 'engagement_farming': explicit requests for likes/retweets/replies. 'ragebait': intentionally provocative to cause anger. 'hate_speech': attacks on protected groups.";

async function classifyWithOpenAI(content: string, apiKey?: string) {
  const client = apiKey ? new OpenAI({ apiKey }) : openai;
  if (!client) throw new Error("OpenAI API key not configured");

  const completion = await client.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: content },
    ],
    model: "gpt-3.5-turbo",
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const responseContent = completion.choices[0].message.content;
  if (!responseContent) throw new Error("No content received from OpenAI");
  return JSON.parse(responseContent);
}

async function classifyWithGemini(content: string, apiKey?: string) {
  const key = apiKey || env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API key not configured");

  // Log the tweet content being classified
  console.log(
    "[GEMINI] Classifying tweet:",
    content.substring(0, 100) + (content.length > 100 ? "..." : "")
  );

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
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Gemini might wrap JSON in markdown code blocks
  const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid JSON response from Gemini");

  return JSON.parse(jsonMatch[0]);
}

async function classifyWithAnthropic(content: string, apiKey?: string) {
  const client = apiKey ? new Anthropic({ apiKey }) : anthropic;
  if (!client) throw new Error("Anthropic API key not configured");

  const message = await client.messages.create({
    max_tokens: 1024,
    messages: [{ role: "user", content: `${SYSTEM_PROMPT}\n\n${content}` }],
    model: "claude-3-opus-20240229",
  });

  const responseContent =
    message.content[0].type === "text" ? message.content[0].text : "";
  if (!responseContent) throw new Error("No content received from Anthropic");

  // Anthropic might wrap JSON in markdown code blocks
  const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid JSON response from Anthropic");

  return JSON.parse(jsonMatch[0]);
}

export async function classifyTweet(
  text: string,
  apiKey?: string,
  provider: LLMProvider = "openai",
  context?: string
): Promise<{ aiProbability: number; category: string; reason: string }> {
  const prompt = context
    ? `Context (Parent Tweet): "${context}"\n\nTweet to Classify: "${text}"\n\nClassify the 'Tweet to Classify'.`
    : `Tweet: ${text}`;

  try {
    let result;
    switch (provider) {
      case "gemini":
        result = await classifyWithGemini(prompt, apiKey);
        break;
      case "anthropic":
        result = await classifyWithAnthropic(prompt, apiKey);
        break;
      case "openai":
      default:
        result = await classifyWithOpenAI(prompt, apiKey);
    }

    return {
      aiProbability: result.ai_probability ?? result.aiProbability ?? 0,
      category: result.category || "normal",
      reason: result.reason ?? "No reason provided",
    };
  } catch (error) {
    console.error(`LLM Classification Error (${provider}):`, error);
    return {
      aiProbability: 0,
      category: "normal",
      reason: "Error in classification service",
    };
  }
}

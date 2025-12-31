import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

export type LLMProvider = "openai" | "gemini" | "anthropic";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

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
  const client = apiKey ? new GoogleGenerativeAI(apiKey) : gemini;
  if (!client) throw new Error("Gemini API key not configured");

  const model = client.getGenerativeModel({ model: "gemini-pro" });
  const result = await model.generateContent(`${SYSTEM_PROMPT}\n\n${content}`);
  const response = await result.response;
  const textResponse = response.text();

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

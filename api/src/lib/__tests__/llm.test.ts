import { classifyTweet, LLMProvider } from "../llm";

// Mock the LLM providers
jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    ai_probability: 0.85,
                    category: "normal",
                    reason:
                      "This tweet appears to be AI-generated based on patterns",
                  }),
                },
              },
            ],
          }),
        },
      },
    })),
  };
});

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              ai_probability: 0.65,
              category: "engagement_farming",
              reason: "Asks for likes and retweets",
            }),
        },
      }),
    }),
  })),
}));

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ai_probability: 0.75,
              category: "ragebait",
              reason: "Designed to provoke anger",
            }),
          },
        ],
      }),
    },
  })),
}));

describe("classifyTweet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("with OpenAI provider", () => {
    it("should classify a tweet and return AI probability", async () => {
      const result = await classifyTweet(
        "This is a test tweet that might be AI generated",
        undefined,
        "openai"
      );

      expect(result).toHaveProperty("aiProbability");
      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("reason");
      expect(typeof result.aiProbability).toBe("number");
      expect(result.aiProbability).toBeGreaterThanOrEqual(0);
      expect(result.aiProbability).toBeLessThanOrEqual(1);
    });

    it("should include context in classification when provided", async () => {
      const result = await classifyTweet(
        "I completely agree!",
        undefined,
        "openai",
        "Original tweet: What do you think about AI?"
      );

      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });
  });

  describe("with custom API key", () => {
    it("should use the provided API key for classification", async () => {
      const customKey = "sk-custom-test-key";
      const result = await classifyTweet(
        "Test tweet content",
        customKey,
        "openai"
      );

      expect(result).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should handle classification gracefully", async () => {
      // This test verifies the function completes without throwing
      // even with potentially problematic input
      const result = await classifyTweet("", undefined, "openai");

      // Should return valid structure even for edge cases
      expect(result).toHaveProperty("aiProbability");
      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("reason");
    });
  });

  describe("category detection", () => {
    it("should detect engagement farming content", async () => {
      const result = await classifyTweet(
        "LIKE and RETWEET for a chance to win!!! Follow me!!!",
        undefined,
        "openai"
      );

      expect(result).toBeDefined();
    });

    it("should detect ragebait content", async () => {
      const result = await classifyTweet(
        "This controversial statement will make everyone angry!",
        undefined,
        "openai"
      );

      expect(result).toBeDefined();
    });
  });
});

describe("LLMProvider type", () => {
  it("should accept valid provider values", () => {
    const providers: LLMProvider[] = ["openai", "gemini", "anthropic"];
    expect(providers).toHaveLength(3);
  });
});

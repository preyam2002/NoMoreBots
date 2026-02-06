import { NextRequest } from "next/server";

// Mock Prisma client
const mockPrisma = {
  extensionUser: {
    upsert: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  userRule: {
    findMany: jest.fn(),
  },
  tweet: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  author: {
    upsert: jest.fn(),
  },
  classificationLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn((callback) => callback(mockPrisma)),
};

jest.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

jest.mock("@/lib/ratelimit", () => ({
  rateLimit: jest.fn(() => ({ success: true })),
}));

jest.mock("@/lib/llm", () => ({
  classifyTweet: jest.fn().mockResolvedValue({
    aiProbability: 0.85,
    category: "normal",
    reason: "Appears to be AI-generated",
  }),
}));

// Import after mocks are set up
import { POST } from "../route";

describe("POST /api/classify", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockPrisma.extensionUser.upsert.mockResolvedValue({
      id: "test-user-id",
      isPremium: false,
      requestCount: 0,
      filterEngagement: false,
      filterRagebait: false,
      filterHateSpeech: false,
    });
    mockPrisma.userRule.findMany.mockResolvedValue([]);
    mockPrisma.tweet.findUnique.mockResolvedValue(null);
    mockPrisma.extensionUser.update.mockResolvedValue({});
  });

  function createMockRequest(
    body: object,
    headers: Record<string, string> = {}
  ) {
    const defaultHeaders = {
      "content-type": "application/json",
      "x-user-id": "test-user-id",
      ...headers,
    };

    return new Request("http://localhost:3000/api/classify", {
      method: "POST",
      headers: defaultHeaders,
      body: JSON.stringify(body),
    });
  }

  describe("successful classification", () => {
    it("should classify a batch of tweets", async () => {
      const request = createMockRequest({
        tweets: [
          { id: "tweet-1", text: "Hello world", authorHandle: "testuser" },
          { id: "tweet-2", text: "Another tweet", authorHandle: "testuser2" },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(2);
      expect(data.results[0]).toHaveProperty("tweetId", "tweet-1");
      expect(data.results[0]).toHaveProperty("aiProbability");
    });

    it("should use cached results for known tweets", async () => {
      mockPrisma.tweet.findUnique.mockResolvedValueOnce({
        id: "cached-tweet",
        aiProbability: 0.9,
      });

      const request = createMockRequest({
        tweets: [
          { id: "cached-tweet", text: "Cached content", authorHandle: "user" },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results[0].cached).toBe(true);
      expect(data.results[0].aiProbability).toBe(0.9);
    });
  });

  describe("validation", () => {
    it("should reject request without x-user-id header", async () => {
      const request = new Request("http://localhost:3000/api/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tweets: [{ id: "1", text: "test", authorHandle: "user" }],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it("should reject empty tweets array", async () => {
      const request = createMockRequest({ tweets: [] });
      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it("should reject tweets array exceeding max batch size", async () => {
      const tweets = Array(25)
        .fill(null)
        .map((_, i) => ({
          id: `tweet-${i}`,
          text: "Test tweet",
          authorHandle: "user",
        }));

      const request = createMockRequest({ tweets });
      const response = await POST(request);
      expect(response.status).toBe(400);
    });
  });

  describe("user rules", () => {
    it("should whitelist tweets from trusted authors", async () => {
      mockPrisma.userRule.findMany.mockResolvedValue([
        { type: "WHITELIST", value: "trusteduser" },
      ]);

      const request = createMockRequest({
        tweets: [
          { id: "tweet-1", text: "Content", authorHandle: "trusteduser" },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.results[0].aiProbability).toBe(0);
      expect(data.results[0].reason).toBe("User Whitelist");
    });

    it("should blacklist tweets from blocked authors", async () => {
      mockPrisma.userRule.findMany.mockResolvedValue([
        { type: "BLACKLIST", value: "spammer" },
      ]);

      const request = createMockRequest({
        tweets: [
          { id: "tweet-1", text: "Spam content", authorHandle: "spammer" },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.results[0].aiProbability).toBe(1);
      expect(data.results[0].reason).toBe("User Blacklist");
    });

    it("should block tweets matching keyword rules", async () => {
      mockPrisma.userRule.findMany.mockResolvedValue([
        { type: "KEYWORD", value: "crypto" },
      ]);

      const request = createMockRequest({
        tweets: [
          { id: "tweet-1", text: "Buy crypto now!", authorHandle: "user" },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.results[0].aiProbability).toBe(1);
      expect(data.results[0].reason).toContain("Keyword match");
    });
  });

  describe("rate limiting", () => {
    it("should return 402 when free limit is reached", async () => {
      mockPrisma.extensionUser.upsert.mockResolvedValue({
        id: "test-user-id",
        isPremium: false,
        requestCount: 100, // At limit
        filterEngagement: false,
        filterRagebait: false,
        filterHateSpeech: false,
      });

      const request = createMockRequest({
        tweets: [{ id: "tweet-1", text: "Content", authorHandle: "user" }],
      });

      const response = await POST(request);
      expect(response.status).toBe(402);
    });

    it("should allow premium users past the limit", async () => {
      mockPrisma.extensionUser.upsert.mockResolvedValue({
        id: "test-user-id",
        isPremium: true,
        requestCount: 500,
        filterEngagement: false,
        filterRagebait: false,
        filterHateSpeech: false,
      });

      const request = createMockRequest({
        tweets: [{ id: "tweet-1", text: "Content", authorHandle: "user" }],
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });
});

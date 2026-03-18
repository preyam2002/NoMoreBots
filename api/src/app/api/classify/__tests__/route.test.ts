// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: any = {
  extensionUser: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  userRule: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  tweet: {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
  },
  author: {
    upsert: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  classificationLog: {
    create: jest.fn(),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: jest.fn((callback: (prisma: any) => any) => callback(mockPrisma)),
};

jest.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

const mockAuthenticateExtensionUser = jest.fn();

jest.mock("@/lib/auth", () => ({
  authenticateExtensionUser: (...args: unknown[]) =>
    mockAuthenticateExtensionUser(...args),
  isAuthErrorResponse: (value: unknown) => value instanceof Response,
}));

jest.mock("@/lib/ratelimit", () => ({
  rateLimit: jest.fn(() => ({ success: true })),
  getRateLimitStatus: jest.fn(() => ({
    remaining: 59,
    limit: 60,
    resetTime: Date.now() + 60000,
  })),
  addRateLimitHeaders: jest.fn((response) => response),
}));

jest.mock("@/lib/llm", () => ({
  classifyTweet: jest.fn().mockResolvedValue({
    aiProbability: 0.85,
    category: "normal",
    reason: "Appears to be AI-generated",
  }),
}));

// Import after mocks are set up
import { classifyTweet } from "@/lib/llm";
import { POST } from "../route";

describe("POST /api/classify", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockAuthenticateExtensionUser.mockResolvedValue({
      id: "test-user-id",
      isPremium: false,
      plan: "FREE",
      requestCount: 0,
      lastRequest: new Date(),
      filterEngagement: false,
      filterRagebait: false,
      filterHateSpeech: false,
      filterRacism: false,
      filterVaguePosting: false,
      filterFearmongering: false,
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
      mockPrisma.tweet.findMany.mockResolvedValueOnce([
        { id: "cached-tweet", aiProbability: 0.9 },
      ]);

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

    it("should classify media-only tweets when media metadata is present", async () => {
      const request = createMockRequest({
        tweets: [
          {
            id: "tweet-media-only",
            text: "",
            mediaSummary: "1 image. image alt text: screenshot of an argument thread",
            authorHandle: "user",
            isReply: true,
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(1);
      expect(classifyTweet).toHaveBeenCalledWith(
        "",
        undefined,
        "gemini",
        expect.objectContaining({
          mediaSummary: "1 image. image alt text: screenshot of an argument thread",
          isReply: true,
        })
      );
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

    it("should reject tweets without any text or media context", async () => {
      const request = createMockRequest({
        tweets: [{ id: "1", text: "", authorHandle: "user" }],
      });

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

  describe("request processing", () => {
    it("should allow premium users past the limit", async () => {
      mockAuthenticateExtensionUser.mockResolvedValue({
        id: "test-user-id",
        isPremium: true,
        plan: "PRO",
        requestCount: 500,
        lastRequest: new Date(),
        filterEngagement: false,
        filterRagebait: false,
        filterHateSpeech: false,
        filterRacism: false,
        filterVaguePosting: false,
        filterFearmongering: false,
      });

      const request = createMockRequest({
        tweets: [{ id: "tweet-1", text: "Content", authorHandle: "user" }],
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it("should block LinkedIn scanning on the free plan", async () => {
      const request = createMockRequest({
        tweets: [{ id: "li-1", text: "LinkedIn content", authorHandle: "user", platform: "linkedin" }],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.upgradeRequired).toBe(true);
    });

    it("should block paid provider selection on the free plan", async () => {
      const request = createMockRequest(
        {
          tweets: [{ id: "tweet-1", text: "Content", authorHandle: "user" }],
        },
        {
          "x-provider": "openai",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("Provider");
    });

    it("should not count geo-block matches as billable AI usage", async () => {
      mockPrisma.userRule.findMany.mockResolvedValue([
        { type: "GEO_BLOCK", value: "india" },
      ]);
      mockAuthenticateExtensionUser.mockResolvedValue({
        id: "test-user-id",
        isPremium: true,
        plan: "PRO",
        requestCount: 7,
        lastRequest: new Date(),
        filterEngagement: false,
        filterRagebait: false,
        filterHateSpeech: false,
        filterRacism: false,
        filterVaguePosting: false,
        filterFearmongering: false,
      });
      mockPrisma.author.findMany.mockResolvedValue([
        { handle: "traveler", location: "Bangalore, India" },
      ]);

      const request = createMockRequest({
        tweets: [{ id: "tweet-geo", text: "Local post", authorHandle: "traveler" }],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results[0].label).toBe("geo_blocked");
      expect(data.usage.requestCount).toBe(7);
      expect(mockPrisma.extensionUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestCount: { increment: 0 },
          }),
        })
      );
    });

    it("should convert racism categories into a filtered label when enabled", async () => {
      mockAuthenticateExtensionUser.mockResolvedValue({
        id: "test-user-id",
        isPremium: true,
        plan: "PRO",
        requestCount: 0,
        lastRequest: new Date(),
        filterEngagement: false,
        filterRagebait: false,
        filterHateSpeech: false,
        filterRacism: true,
        filterVaguePosting: false,
        filterFearmongering: false,
      });
      (classifyTweet as jest.Mock).mockResolvedValueOnce({
        aiProbability: 0.22,
        category: "racism",
        reason: "Uses race-based slurs and exclusionary framing",
      });

      const request = createMockRequest({
        tweets: [{ id: "tweet-racism", text: "example", authorHandle: "user" }],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results[0].label).toBe("racism");
      expect(data.results[0].aiProbability).toBe(1);
      expect(data.results[0].reason).toContain("Filtered: Racism.");
    });

    it("should convert vague-posting categories into a filtered label when enabled", async () => {
      mockAuthenticateExtensionUser.mockResolvedValue({
        id: "test-user-id",
        isPremium: true,
        plan: "PRO",
        requestCount: 0,
        lastRequest: new Date(),
        filterEngagement: false,
        filterRagebait: false,
        filterHateSpeech: false,
        filterRacism: false,
        filterVaguePosting: true,
        filterFearmongering: false,
      });
      (classifyTweet as jest.Mock).mockResolvedValueOnce({
        aiProbability: 0.33,
        category: "vague_posting",
        reason: "Cryptic grievance without details",
      });

      const request = createMockRequest({
        tweets: [{ id: "tweet-vague", text: "example", authorHandle: "user" }],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results[0].label).toBe("vague_posting");
      expect(data.results[0].reason).toContain("Filtered: Vague Posting.");
    });
  });
});

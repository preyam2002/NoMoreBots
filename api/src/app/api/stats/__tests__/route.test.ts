// Mock Prisma client
const mockPrisma = {
  extensionUser: {
    upsert: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  userRule: {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
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

import { GET } from "../route";

describe("Stats API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/stats", () => {
    it("should return stats for a valid user", async () => {
      mockPrisma.extensionUser.findUnique.mockResolvedValue({
        id: "user-1",
        tweetsScanned: 150,
        botsBlocked: 42,
        requestCount: 100,
        isPremium: false,
        filterEngagement: true,
        filterRagebait: false,
        filterHateSpeech: true,
      });

      const request = new Request(
        "http://localhost:3000/api/stats?userId=user-1"
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.scanned).toBe(150);
      expect(data.hidden).toBe(42);
      expect(data.requestCount).toBe(100);
      expect(data.dailyLimit).toBe(100);
      expect(data.isPremium).toBe(false);
    });

    it("should return premium limit for premium users", async () => {
      mockPrisma.extensionUser.findUnique.mockResolvedValue({
        id: "user-1",
        tweetsScanned: 500,
        botsBlocked: 100,
        requestCount: 450,
        isPremium: true,
        filterEngagement: false,
        filterRagebait: true,
        filterHateSpeech: false,
      });

      const request = new Request(
        "http://localhost:3000/api/stats?userId=user-1"
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isPremium).toBe(true);
      expect(data.dailyLimit).toBe(10000);
    });

    it("should return error when userId is missing", async () => {
      const request = new Request("http://localhost:3000/api/stats");
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent user", async () => {
      mockPrisma.extensionUser.findUnique.mockResolvedValue(null);

      const request = new Request(
        "http://localhost:3000/api/stats?userId=non-existent"
      );
      const response = await GET(request);

      expect(response.status).toBe(404);
    });

    it("should return filter settings", async () => {
      mockPrisma.extensionUser.findUnique.mockResolvedValue({
        id: "user-1",
        tweetsScanned: 0,
        botsBlocked: 0,
        requestCount: 0,
        isPremium: false,
        filterEngagement: true,
        filterRagebait: true,
        filterHateSpeech: true,
      });

      const request = new Request(
        "http://localhost:3000/api/stats?userId=user-1"
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.filterEngagement).toBe(true);
      expect(data.filterRagebait).toBe(true);
      expect(data.filterHateSpeech).toBe(true);
    });
  });
});

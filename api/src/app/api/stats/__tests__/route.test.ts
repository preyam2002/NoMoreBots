// Mock Prisma client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: any = {
  extensionUser: {
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

import { GET } from "../route";

describe("Stats API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticateExtensionUser.mockResolvedValue({ id: "user-1" });
  });

  describe("GET /api/stats", () => {
    it("should return stats for a valid user", async () => {
      mockPrisma.extensionUser.findUnique.mockResolvedValue({
        id: "user-1",
        tweetsScanned: 150,
        botsBlocked: 42,
        requestCount: 100,
        isPremium: false,
        plan: "FREE",
        filterEngagement: true,
        filterRagebait: false,
        filterHateSpeech: true,
        filterRacism: false,
        filterVaguePosting: true,
        filterFearmongering: false,
      });
      const request = new Request(
        "http://localhost:3000/api/stats?userId=user-1",
        { headers: { "x-client-token": "token" } }
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.scanned).toBe(150);
      expect(data.hidden).toBe(42);
      expect(data.requestCount).toBe(100);
      expect(data.dailyLimit).toBe(100);
      expect(data.isPremium).toBe(false);
      expect(data.plan).toBe("FREE");
    });

    it("should return premium limit for premium users", async () => {
      mockPrisma.extensionUser.findUnique.mockResolvedValue({
        tweetsScanned: 500,
        botsBlocked: 100,
        requestCount: 450,
        isPremium: true,
        plan: "PRO",
        filterEngagement: false,
        filterRagebait: true,
        filterHateSpeech: false,
        filterRacism: true,
        filterVaguePosting: false,
        filterFearmongering: true,
      });

      const request = new Request(
        "http://localhost:3000/api/stats?userId=user-1",
        { headers: { "x-client-token": "token" } }
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isPremium).toBe(true);
      expect(data.dailyLimit).toBe(10000);
      expect(data.plan).toBe("PRO");
    });

    it("should return error when userId is missing", async () => {
      const request = new Request("http://localhost:3000/api/stats");
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    it("should return not found when the user does not exist", async () => {
      mockPrisma.extensionUser.findUnique.mockResolvedValue(null);

      const request = new Request(
        "http://localhost:3000/api/stats?userId=non-existent",
        { headers: { "x-client-token": "token" } }
      );
      const response = await GET(request);

      expect(response.status).toBe(404);
    });

    it("should return filter settings", async () => {
      mockPrisma.extensionUser.findUnique.mockResolvedValue({
        tweetsScanned: 0,
        botsBlocked: 0,
        requestCount: 0,
        isPremium: false,
        plan: "FREE",
        filterEngagement: true,
        filterRagebait: true,
        filterHateSpeech: true,
        filterRacism: true,
        filterVaguePosting: true,
        filterFearmongering: true,
      });

      const request = new Request(
        "http://localhost:3000/api/stats?userId=user-1",
        { headers: { "x-client-token": "token" } }
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.filterEngagement).toBe(true);
      expect(data.filterRagebait).toBe(true);
      expect(data.filterHateSpeech).toBe(true);
      expect(data.filterRacism).toBe(true);
      expect(data.filterVaguePosting).toBe(true);
      expect(data.filterFearmongering).toBe(true);
    });
  });
});

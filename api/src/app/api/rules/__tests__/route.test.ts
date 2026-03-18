// Mock Prisma client
const mockPrisma = {
  userRule: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
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

import { GET, POST, DELETE } from "../route";

describe("Rules API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticateExtensionUser.mockResolvedValue({
      plan: "FREE",
      isPremium: false,
    });
    mockPrisma.userRule.findFirst.mockResolvedValue(null);
    mockPrisma.userRule.count.mockResolvedValue(0);
  });

  describe("GET /api/rules", () => {
    it("should return rules for a valid user", async () => {
      const mockRules = [
        {
          id: "rule-1",
          type: "WHITELIST",
          value: "trusteduser",
          userId: "user-1",
        },
        { id: "rule-2", type: "BLACKLIST", value: "spammer", userId: "user-1" },
      ];
      mockPrisma.userRule.findMany.mockResolvedValue(mockRules);

      const request = new Request(
        "http://localhost:3000/api/rules?userId=user-1",
        { headers: { "x-client-token": "token" } }
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.rules).toHaveLength(2);
      expect(data.rules[0].type).toBe("WHITELIST");
    });

    it("should return error when userId is missing", async () => {
      const request = new Request("http://localhost:3000/api/rules");
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    it("should return empty array when user has no rules", async () => {
      mockPrisma.userRule.findMany.mockResolvedValue([]);

      const request = new Request(
        "http://localhost:3000/api/rules?userId=new-user",
        { headers: { "x-client-token": "token" } }
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.rules).toHaveLength(0);
    });
  });

  describe("POST /api/rules", () => {
    it("should create a whitelist rule", async () => {
      const newRule = {
        id: "new-rule-1",
        userId: "user-1",
        type: "WHITELIST",
        value: "friendlyuser",
      };
      mockPrisma.userRule.create.mockResolvedValue(newRule);

      const request = new Request("http://localhost:3000/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-token": "token" },
        body: JSON.stringify({
          userId: "user-1",
          type: "WHITELIST",
          value: "friendlyuser",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.rule.type).toBe("WHITELIST");
    });

    it("should strip @ from handle values", async () => {
      mockPrisma.userRule.create.mockResolvedValue({
        id: "rule-1",
        userId: "user-1",
        type: "BLACKLIST",
        value: "blockeduser",
      });

      const request = new Request("http://localhost:3000/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-token": "token" },
        body: JSON.stringify({
          userId: "user-1",
          type: "BLACKLIST",
          value: "@blockeduser",
        }),
      });

      await POST(request);

      expect(mockPrisma.userRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          value: "blockeduser", // @ stripped
        }),
      });
    });

    it("should lowercase keyword values", async () => {
      mockPrisma.userRule.create.mockResolvedValue({
        id: "rule-1",
        userId: "user-1",
        type: "KEYWORD",
        value: "crypto",
      });

      const request = new Request("http://localhost:3000/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-token": "token" },
        body: JSON.stringify({
          userId: "user-1",
          type: "KEYWORD",
          value: "CRYPTO",
        }),
      });

      await POST(request);

      expect(mockPrisma.userRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          value: "crypto", // lowercased
        }),
      });
    });

    it("should reject invalid rule type", async () => {
      const request = new Request("http://localhost:3000/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-token": "token" },
        body: JSON.stringify({
          userId: "user-1",
          type: "INVALID_TYPE",
          value: "test",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it("should reject empty value", async () => {
      const request = new Request("http://localhost:3000/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-token": "token" },
        body: JSON.stringify({
          userId: "user-1",
          type: "WHITELIST",
          value: "",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it("should reject geo-block rules on the free plan", async () => {
      const request = new Request("http://localhost:3000/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-token": "token" },
        body: JSON.stringify({
          userId: "user-1",
          type: "GEO_BLOCK",
          value: "india",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.upgradeRequired).toBe(true);
    });

    it("should allow geo-block rules on pro", async () => {
      mockAuthenticateExtensionUser.mockResolvedValue({
        plan: "PRO",
        isPremium: true,
      });
      mockPrisma.userRule.create.mockResolvedValue({
        id: "geo-1",
        userId: "user-1",
        type: "GEO_BLOCK",
        value: "india",
      });

      const request = new Request("http://localhost:3000/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-token": "token" },
        body: JSON.stringify({
          userId: "user-1",
          type: "GEO_BLOCK",
          value: "India",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.rule.type).toBe("GEO_BLOCK");
    });

    it("should reject new rules when the plan limit is reached", async () => {
      mockPrisma.userRule.count.mockResolvedValue(20);

      const request = new Request("http://localhost:3000/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-token": "token" },
        body: JSON.stringify({
          userId: "user-1",
          type: "KEYWORD",
          value: "test",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
    });

    it("should return an existing duplicate rule instead of creating a new one", async () => {
      mockPrisma.userRule.findFirst.mockResolvedValue({
        id: "existing-rule",
        userId: "user-1",
        type: "KEYWORD",
        value: "crypto",
      });

      const request = new Request("http://localhost:3000/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-token": "token" },
        body: JSON.stringify({
          userId: "user-1",
          type: "KEYWORD",
          value: "crypto",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.duplicate).toBe(true);
      expect(mockPrisma.userRule.create).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/rules", () => {
    it("should delete a rule belonging to the user", async () => {
      mockPrisma.userRule.findUnique.mockResolvedValue({
        id: "rule-1",
        userId: "user-1",
        type: "WHITELIST",
        value: "test",
      });
      mockPrisma.userRule.delete.mockResolvedValue({});

      const request = new Request(
        "http://localhost:3000/api/rules?id=rule-1&userId=user-1",
        { method: "DELETE", headers: { "x-client-token": "token" } }
      );

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("should reject deletion if rule belongs to different user", async () => {
      mockPrisma.userRule.findUnique.mockResolvedValue({
        id: "rule-1",
        userId: "other-user",
        type: "WHITELIST",
        value: "test",
      });

      const request = new Request(
        "http://localhost:3000/api/rules?id=rule-1&userId=user-1",
        { method: "DELETE", headers: { "x-client-token": "token" } }
      );

      const response = await DELETE(request);
      expect(response.status).toBe(403);
    });

    it("should return error when id or userId is missing", async () => {
      const request = new Request("http://localhost:3000/api/rules?id=rule-1", {
        method: "DELETE",
      });

      const response = await DELETE(request);
      expect(response.status).toBe(400);
    });
  });
});

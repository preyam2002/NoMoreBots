// Mock Prisma client
const mockPrisma = {
  userRule: {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

import { GET, POST, DELETE } from "../route";

describe("Rules API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
        "http://localhost:3000/api/rules?userId=user-1"
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
        "http://localhost:3000/api/rules?userId=new-user"
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          type: "WHITELIST",
          value: "",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
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
        { method: "DELETE" }
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
        { method: "DELETE" }
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

const mockPrisma = {
  extensionUser: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

import { POST } from "../route";

describe("Register API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create a new user with a client token", async () => {
    mockPrisma.extensionUser.findUnique.mockResolvedValue(null);
    mockPrisma.extensionUser.create.mockResolvedValue({
      id: "user-1",
      clientTokenHash: "hashed-token",
      isPremium: false,
      plan: "FREE",
    });

    const response = await POST(
      new Request("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.userId).toBe("user-1");
    expect(typeof data.clientToken).toBe("string");
    expect(data.clientToken.length).toBeGreaterThan(10);
    expect(mockPrisma.extensionUser.create).toHaveBeenCalled();
  });

  it("should attach a token to an existing legacy user", async () => {
    mockPrisma.extensionUser.findUnique.mockResolvedValue({
      id: "legacy-user",
      clientTokenHash: null,
      isPremium: true,
      plan: "PRO",
    });
    mockPrisma.extensionUser.update.mockResolvedValue({
      id: "legacy-user",
      clientTokenHash: "hashed-token",
      isPremium: true,
      plan: "PRO",
    });

    const response = await POST(
      new Request("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ existingUserId: "legacy-user" }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.userId).toBe("legacy-user");
    expect(data.plan).toBe("PRO");
    expect(mockPrisma.extensionUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "legacy-user" },
      })
    );
  });

  it("should reject re-registering a secured user without the existing token", async () => {
    mockPrisma.extensionUser.findUnique.mockResolvedValue({
      id: "user-1",
      clientTokenHash: "already-set",
      isPremium: false,
      plan: "FREE",
    });

    const response = await POST(
      new Request("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ existingUserId: "user-1" }),
      })
    );

    expect(response.status).toBe(409);
    expect(mockPrisma.extensionUser.update).not.toHaveBeenCalled();
  });
});

const mockPrisma = {
  extensionUser: {
    update: jest.fn(),
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

import { POST } from "../route";

describe("Settings API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticateExtensionUser.mockResolvedValue({
      id: "user-1",
      plan: "FREE",
      isPremium: false,
    });
    mockPrisma.extensionUser.update.mockResolvedValue({
      id: "user-1",
      filterEngagement: false,
      filterRagebait: false,
      filterHateSpeech: false,
      filterRacism: false,
      filterVaguePosting: false,
      filterFearmongering: false,
    });
  });

  it("should reject advanced filters on the free plan", async () => {
    const request = new Request("http://localhost:3000/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-token": "token" },
      body: JSON.stringify({
        userId: "user-1",
        filterEngagement: true,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.upgradeRequired).toBe(true);
    expect(mockPrisma.extensionUser.update).not.toHaveBeenCalled();
  });

  it("should allow disabling filters on the free plan", async () => {
    const request = new Request("http://localhost:3000/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-token": "token" },
      body: JSON.stringify({
        userId: "user-1",
        filterEngagement: false,
        filterRagebait: false,
        filterHateSpeech: false,
        filterRacism: false,
        filterVaguePosting: false,
        filterFearmongering: false,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.extensionUser.update).toHaveBeenCalled();
  });

  it("should allow advanced filters on pro", async () => {
    mockAuthenticateExtensionUser.mockResolvedValue({
      id: "user-1",
      plan: "PRO",
      isPremium: true,
    });

    const request = new Request("http://localhost:3000/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-token": "token" },
      body: JSON.stringify({
        userId: "user-1",
        filterFearmongering: true,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.plan).toBe("PRO");
    expect(mockPrisma.extensionUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          filterFearmongering: true,
        }),
      })
    );
  });

  it("should validate the request body", async () => {
    const request = new Request("http://localhost:3000/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filterEngagement: true,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});

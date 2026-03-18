import {
  rateLimit,
  getRateLimitStats,
  getRateLimitStatus,
} from "../ratelimit";

describe("Rate Limit Module", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("rateLimit", () => {
    it("should allow first request from an IP", async () => {
      const result = await rateLimit("192.168.1.1");
      expect(result.success).toBe(true);
    });

    it("should allow multiple requests within limit", async () => {
      const ip = "192.168.1.2";
      for (let i = 0; i < 60; i++) {
        const result = await rateLimit(ip);
        expect(result.success).toBe(true);
      }
    });

    it("should block requests exceeding limit", async () => {
      const ip = "192.168.1.3";
      for (let i = 0; i < 60; i++) {
        await rateLimit(ip);
      }

      const result = await rateLimit(ip);
      expect(result.success).toBe(false);
      expect(result.reset).toBeDefined();
    });

    it("should reset after window expires", async () => {
      const ip = "192.168.1.4";

      for (let i = 0; i < 60; i++) {
        await rateLimit(ip);
      }

      expect((await rateLimit(ip)).success).toBe(false);

      jest.advanceTimersByTime(60 * 1000 + 1);

      expect((await rateLimit(ip)).success).toBe(true);
    });

    it("should track different IPs independently", async () => {
      const ip1 = "192.168.1.5";
      const ip2 = "192.168.1.6";

      for (let i = 0; i < 60; i++) {
        await rateLimit(ip1);
      }

      expect((await rateLimit(ip1)).success).toBe(false);
      expect((await rateLimit(ip2)).success).toBe(true);
    });
  });

  describe("getRateLimitStats", () => {
    it("should return correct stats", async () => {
      await rateLimit("192.168.1.10");
      await rateLimit("192.168.1.10");
      await rateLimit("192.168.1.11");

      const stats = await getRateLimitStats();

      expect(stats.totalRequests).toBeGreaterThanOrEqual(3);
      expect(stats.activeClients).toBeGreaterThanOrEqual(2);
      expect(stats.maxRequests).toBe(60);
    });
  });

  describe("getRateLimitStatus", () => {
    it("should return remaining requests for new IP", async () => {
      const status = await getRateLimitStatus("192.168.1.20");

      expect(status.remaining).toBe(60);
      expect(status.limit).toBe(60);
    });

    it("should return remaining requests after some usage", async () => {
      const ip = "192.168.1.21";
      await rateLimit(ip);
      await rateLimit(ip);

      const status = await getRateLimitStatus(ip);

      expect(status.remaining).toBe(58);
      expect(status.limit).toBe(60);
    });

    it("should return 0 remaining when at limit", async () => {
      const ip = "192.168.1.22";
      for (let i = 0; i < 60; i++) {
        await rateLimit(ip);
      }

      const status = await getRateLimitStatus(ip);

      expect(status.remaining).toBe(0);
    });
  });
});

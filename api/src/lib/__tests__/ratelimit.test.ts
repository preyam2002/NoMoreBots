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
    it("should allow first request from an IP", () => {
      const result = rateLimit("192.168.1.1");
      expect(result.success).toBe(true);
    });

    it("should allow multiple requests within limit", () => {
      const ip = "192.168.1.2";
      for (let i = 0; i < 60; i++) {
        const result = rateLimit(ip);
        expect(result.success).toBe(true);
      }
    });

    it("should block requests exceeding limit", () => {
      const ip = "192.168.1.3";
      for (let i = 0; i < 60; i++) {
        rateLimit(ip);
      }

      const result = rateLimit(ip);
      expect(result.success).toBe(false);
      expect(result.reset).toBeDefined();
    });

    it("should reset after window expires", () => {
      const ip = "192.168.1.4";

      for (let i = 0; i < 60; i++) {
        rateLimit(ip);
      }

      expect(rateLimit(ip).success).toBe(false);

      jest.advanceTimersByTime(60 * 1000 + 1);

      expect(rateLimit(ip).success).toBe(true);
    });

    it("should track different IPs independently", () => {
      const ip1 = "192.168.1.5";
      const ip2 = "192.168.1.6";

      for (let i = 0; i < 60; i++) {
        rateLimit(ip1);
      }

      expect(rateLimit(ip1).success).toBe(false);
      expect(rateLimit(ip2).success).toBe(true);
    });
  });

  describe("getRateLimitStats", () => {
    it("should return correct stats", () => {
      rateLimit("192.168.1.10");
      rateLimit("192.168.1.10");
      rateLimit("192.168.1.11");

      const stats = getRateLimitStats();

      expect(stats.totalRequests).toBeGreaterThanOrEqual(3);
      expect(stats.activeClients).toBeGreaterThanOrEqual(2);
      expect(stats.maxRequests).toBe(60);
    });
  });

  describe("getRateLimitStatus", () => {
    it("should return remaining requests for new IP", () => {
      const status = getRateLimitStatus("192.168.1.20");

      expect(status.remaining).toBe(60);
      expect(status.limit).toBe(60);
    });

    it("should return remaining requests after some usage", () => {
      const ip = "192.168.1.21";
      rateLimit(ip);
      rateLimit(ip);

      const status = getRateLimitStatus(ip);

      expect(status.remaining).toBe(58);
      expect(status.limit).toBe(60);
    });

    it("should return 0 remaining when at limit", () => {
      const ip = "192.168.1.22";
      for (let i = 0; i < 60; i++) {
        rateLimit(ip);
      }

      const status = getRateLimitStatus(ip);

      expect(status.remaining).toBe(0);
    });
  });
});

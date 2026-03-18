import { NextResponse } from "next/server";
import { getPlanDefinition, normalizePlanId } from "@shared/plans";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const FREE_DAILY_LIMIT = 100;
export const FREE_MONTHLY_LIMIT = 3000;
export const WINDOW_SIZE_MS = 60 * 1000;

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const inMemoryStore: RateLimitStore = {};
let lastCleanupAt = 0;

function getWindowStart(now = new Date()) {
  return new Date(Math.floor(now.getTime() / WINDOW_SIZE_MS) * WINDOW_SIZE_MS);
}

function getWindowResetTime(windowStart: Date) {
  return windowStart.getTime() + WINDOW_SIZE_MS;
}

function getRateLimitKey(ip: string, userId?: string) {
  return userId || ip;
}

function getMaxRequestsPerMinute() {
  return env.RATE_LIMIT_REQUESTS_PER_MINUTE;
}

function shouldUseInMemoryStore() {
  return env.NODE_ENV === "test";
}

function rateLimitInMemory(ip: string, userId?: string) {
  const now = Date.now();
  const limit = getMaxRequestsPerMinute();
  const key = getRateLimitKey(ip, userId);
  const record = inMemoryStore[key];

  if (!record || now > record.resetTime) {
    inMemoryStore[key] = {
      count: 1,
      resetTime: now + WINDOW_SIZE_MS,
    };

    return { success: true, remaining: limit - 1 };
  }

  if (record.count >= limit) {
    return {
      success: false,
      reset: record.resetTime,
      message: "Too many requests per minute",
    };
  }

  record.count += 1;

  return {
    success: true,
    remaining: limit - record.count,
  };
}

async function cleanupRateLimitBuckets(now = new Date()) {
  const nowMs = now.getTime();
  if (nowMs - lastCleanupAt < 60 * 60 * 1000) {
    return;
  }

  lastCleanupAt = nowMs;
  const cutoff = new Date(nowMs - 24 * 60 * 60 * 1000);

  prisma.rateLimitBucket
    .deleteMany({
      where: {
        windowStart: {
          lt: cutoff,
        },
      },
    })
    .catch((error) => {
      console.error("Error cleaning rate limit buckets:", error);
    });
}

export async function rateLimit(ip: string, userId?: string) {
  if (shouldUseInMemoryStore()) {
    return rateLimitInMemory(ip, userId);
  }

  const now = new Date();
  const windowStart = getWindowStart(now);
  const resetTime = getWindowResetTime(windowStart);
  const key = getRateLimitKey(ip, userId);
  const limit = getMaxRequestsPerMinute();

  await cleanupRateLimitBuckets(now);

  try {
    const inserted = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "updatedAt")
      VALUES (${key}, ${windowStart}, 1, NOW())
      ON CONFLICT DO NOTHING
      RETURNING "count"
    `;

    if (inserted.length > 0) {
      return { success: true, remaining: Math.max(0, limit - inserted[0].count) };
    }

    const updated = await prisma.$queryRaw<Array<{ count: number }>>`
      UPDATE "RateLimitBucket"
      SET "count" = "count" + 1, "updatedAt" = NOW()
      WHERE "key" = ${key}
        AND "windowStart" = ${windowStart}
        AND "count" < ${limit}
      RETURNING "count"
    `;

    if (updated.length > 0) {
      return { success: true, remaining: Math.max(0, limit - updated[0].count) };
    }

    return {
      success: false,
      reset: resetTime,
      message: "Too many requests per minute",
    };
  } catch (error) {
    console.error("Error enforcing minute rate limit:", error);
    return {
      success: true,
      remaining: limit,
    };
  }
}

export async function checkUserRateLimit(userId: string): Promise<{
  allowed: boolean;
  error?: string;
  limit?: number;
  remaining?: number;
  isPremium?: boolean;
}> {
  if (!userId) {
    return { allowed: true, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
  }

  try {
    const user = await prisma.extensionUser.findUnique({
      where: { id: userId },
      select: {
        isPremium: true,
        plan: true,
        requestCount: true,
        lastRequest: true,
      },
    });

    if (!user) {
      return { allowed: true, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
    }

    const planId = normalizePlanId(user.plan, user.isPremium);
    const planDefinition = getPlanDefinition(planId);
    const limit = planDefinition.dailyRequestLimit;

    const now = new Date();
    const lastRequest = user.lastRequest || new Date(0);
    const isNewDay = now.toDateString() !== lastRequest.toDateString();

    if (isNewDay) {
      await prisma.extensionUser.update({
        where: { id: userId },
        data: { requestCount: 0, lastRequest: now },
      });
      return { allowed: true, limit, remaining: limit, isPremium: planId === "PRO" };
    }

    const currentCount = user.requestCount || 0;
    const remaining = limit - currentCount;

    if (remaining <= 0) {
      return {
        allowed: false,
        error: "Daily limit exceeded. Upgrade to Pro for a higher allowance.",
        limit,
        remaining: 0,
        isPremium: planId === "PRO",
      };
    }

    return { allowed: true, limit, remaining, isPremium: planId === "PRO" };
  } catch (error) {
    console.error("Error checking user rate limit:", error);
    return { allowed: true, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
  }
}

export async function incrementUserRequestCount(
  userId: string,
  count: number = 1
): Promise<void> {
  if (!userId) return;

  try {
    await prisma.extensionUser.update({
      where: { id: userId },
      data: {
        requestCount: { increment: count },
        lastRequest: new Date(),
      },
    });
  } catch (error) {
    console.error("Error incrementing request count:", error);
  }
}

export async function getRateLimitStats() {
  const limit = getMaxRequestsPerMinute();

  if (shouldUseInMemoryStore()) {
    const now = Date.now();
    let activeClients = 0;
    let totalRequests = 0;

    for (const key in inMemoryStore) {
      if (now < inMemoryStore[key].resetTime) {
        activeClients += 1;
        totalRequests += inMemoryStore[key].count;
      } else {
        delete inMemoryStore[key];
      }
    }

    return {
      activeClients,
      totalRequests,
      maxRequests: limit,
      windowMs: WINDOW_SIZE_MS,
    };
  }

  const windowStart = getWindowStart();

  const stats = await prisma.rateLimitBucket.aggregate({
    where: {
      windowStart,
    },
    _count: {
      _all: true,
    },
    _sum: {
      count: true,
    },
  });

  return {
    activeClients: stats._count._all,
    totalRequests: stats._sum.count || 0,
    maxRequests: limit,
    windowMs: WINDOW_SIZE_MS,
  };
}

export async function getRateLimitStatus(ip: string, userId?: string) {
  const limit = getMaxRequestsPerMinute();

  if (shouldUseInMemoryStore()) {
    const now = Date.now();
    const key = getRateLimitKey(ip, userId);
    const record = inMemoryStore[key];

    if (!record || now > record.resetTime) {
      return {
        remaining: limit,
        limit,
        resetTime: now + WINDOW_SIZE_MS,
      };
    }

    return {
      remaining: Math.max(0, limit - record.count),
      limit,
      resetTime: record.resetTime,
    };
  }

  const windowStart = getWindowStart();
  const key = getRateLimitKey(ip, userId);
  const bucket = await prisma.rateLimitBucket.findUnique({
    where: {
      key_windowStart: {
        key,
        windowStart,
      },
    },
  });

  return {
    remaining: Math.max(0, limit - (bucket?.count || 0)),
    limit,
    resetTime: getWindowResetTime(windowStart),
  };
}

export function addRateLimitHeaders(
  response: NextResponse,
  result: { remaining: number; limit: number; resetTime: number }
) {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(Math.max(0, result.remaining)));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetTime / 1000)));
  return response;
}

if (shouldUseInMemoryStore()) {
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const key in inMemoryStore) {
      if (now > inMemoryStore[key].resetTime) {
        delete inMemoryStore[key];
      }
    }
  }, WINDOW_SIZE_MS);

  cleanupInterval.unref?.();
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const FREE_DAILY_LIMIT = 100;
export const FREE_MONTHLY_LIMIT = 3000;

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};
const WINDOW_SIZE_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 60;

export function rateLimit(ip: string, userId?: string) {
  const now = Date.now();
  const key = userId || ip;

  const record = store[key];

  if (!record || now > record.resetTime) {
    store[key] = {
      count: 1,
      resetTime: now + WINDOW_SIZE_MS,
    };
    return { success: true, remaining: MAX_REQUESTS_PER_MINUTE - 1 };
  }

  if (record.count >= MAX_REQUESTS_PER_MINUTE) {
    return { 
      success: false, 
      reset: record.resetTime,
      message: "Too many requests per minute" 
    };
  }

  record.count++;
  return { 
    success: true, 
    remaining: MAX_REQUESTS_PER_MINUTE - record.count 
  };
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
        requestCount: true,
        lastRequest: true,
      },
    });

    if (!user) {
      return { allowed: true, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
    }

    if (user.isPremium) {
      return { allowed: true, isPremium: true };
    }

    const now = new Date();
    const lastRequest = user.lastRequest || new Date(0);
    const isNewDay = now.toDateString() !== lastRequest.toDateString();

    if (isNewDay) {
      await prisma.extensionUser.update({
        where: { id: userId },
        data: { requestCount: 0, lastRequest: now },
      });
      return { allowed: true, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
    }

    const currentCount = user.requestCount || 0;
    const remaining = FREE_DAILY_LIMIT - currentCount;

    if (remaining <= 0) {
      return { 
        allowed: false, 
        error: "Daily limit exceeded. Upgrade to Premium for unlimited requests.",
        limit: FREE_DAILY_LIMIT,
        remaining: 0,
        isPremium: false,
      };
    }

    return { allowed: true, limit: FREE_DAILY_LIMIT, remaining };
  } catch (error) {
    console.error("Error checking user rate limit:", error);
    return { allowed: true, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
  }
}

export async function incrementUserRequestCount(userId: string, count: number = 1): Promise<void> {
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

export function getRateLimitStats() {
  const now = Date.now();
  let activeClients = 0;
  let totalRequests = 0;

  for (const key in store) {
    if (now < store[key].resetTime) {
      activeClients++;
      totalRequests += store[key].count;
    } else {
      delete store[key];
    }
  }

  return {
    activeClients,
    totalRequests,
    maxRequests: MAX_REQUESTS_PER_MINUTE,
    windowMs: WINDOW_SIZE_MS,
  };
}

export function getRateLimitStatus(ip: string, userId?: string) {
  const now = Date.now();
  const key = userId || ip;
  const record = store[key];

  if (!record || now > record.resetTime) {
    return {
      remaining: MAX_REQUESTS_PER_MINUTE,
      limit: MAX_REQUESTS_PER_MINUTE,
      resetTime: now + WINDOW_SIZE_MS,
    };
  }

  return {
    remaining: MAX_REQUESTS_PER_MINUTE - record.count,
    limit: MAX_REQUESTS_PER_MINUTE,
    resetTime: record.resetTime,
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

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const key in store) {
    if (now > store[key].resetTime) {
      delete store[key];
    }
  }
}, WINDOW_SIZE_MS);

import { NextResponse } from "next/server";

interface RateLimitStore {
  [ip: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};
const WINDOW_SIZE_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 60; // 60 requests per minute

export function rateLimit(ip: string) {
  const now = Date.now();
  const record = store[ip];

  if (!record || now > record.resetTime) {
    store[ip] = {
      count: 1,
      resetTime: now + WINDOW_SIZE_MS,
    };
    return { success: true };
  }

  if (record.count >= MAX_REQUESTS) {
    return { success: false, reset: record.resetTime };
  }

  record.count++;
  return { success: true };
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const ip in store) {
    if (now > store[ip].resetTime) {
      delete store[ip];
    }
  }
}, WINDOW_SIZE_MS);

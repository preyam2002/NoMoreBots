import { NextResponse } from "next/server";
import { getRateLimitStats, getRateLimitStatus } from "@/lib/ratelimit";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const detailed = searchParams.get("detailed") === "true";

  try {
    if (detailed) {
      const status = getRateLimitStatus(ip);
      return NextResponse.json({
        ip,
        ...status,
      });
    }

    const stats = getRateLimitStats();
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      ...stats,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get rate limit stats" },
      { status: 500 }
    );
  }
}

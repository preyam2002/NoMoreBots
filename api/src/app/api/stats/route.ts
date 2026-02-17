import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  try {
    const user = await prisma.extensionUser.findUnique({
      where: { id: userId },
      select: {
        tweetsScanned: true,
        botsBlocked: true,
        requestCount: true,
        isPremium: true,
        filterEngagement: true,
        filterRagebait: true,
        filterHateSpeech: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const DAILY_LIMIT = 100;

    return NextResponse.json({
      scanned: user.tweetsScanned,
      hidden: user.botsBlocked,
      requestCount: user.requestCount,
      dailyLimit: user.isPremium ? 10000 : DAILY_LIMIT,
      isPremium: user.isPremium,
      filterEngagement: user.filterEngagement,
      filterRagebait: user.filterRagebait,
      filterHateSpeech: user.filterHateSpeech,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { authenticateExtensionUser, isAuthErrorResponse } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPlanSnapshot, getAiUsageSummary, getAvailablePlans } from "@/lib/plans";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  try {
    const authenticatedUser = await authenticateExtensionUser(request, userId);
    if (isAuthErrorResponse(authenticatedUser)) {
      return authenticatedUser;
    }

    const user = await prisma.extensionUser.findUnique({
      where: { id: userId },
      select: {
        tweetsScanned: true,
        botsBlocked: true,
        requestCount: true,
        isPremium: true,
        plan: true,
        filterEngagement: true,
        filterRagebait: true,
        filterHateSpeech: true,
        filterRacism: true,
        filterVaguePosting: true,
        filterFearmongering: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const planSnapshot = buildPlanSnapshot(user);

    return NextResponse.json({
      scanned: user.tweetsScanned,
      hidden: user.botsBlocked,
      requestCount: user.requestCount,
      dailyLimit: planSnapshot.dailyLimit,
      isPremium: planSnapshot.isPremium,
      plan: planSnapshot.plan,
      featureAccess: planSnapshot.featureAccess,
      filterEngagement: user.filterEngagement,
      filterRagebait: user.filterRagebait,
      filterHateSpeech: user.filterHateSpeech,
      filterRacism: user.filterRacism,
      filterVaguePosting: user.filterVaguePosting,
      filterFearmongering: user.filterFearmongering,
      aiUsage: getAiUsageSummary(),
      availablePlans: getAvailablePlans(),
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

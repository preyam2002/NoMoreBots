import { NextResponse } from "next/server";
import { authenticateExtensionUser, isAuthErrorResponse } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPlanSnapshot } from "@/lib/plans";
import { z } from "zod";

const updateSettingsSchema = z.object({
  userId: z.string(),
  filterEngagement: z.boolean().optional(),
  filterRagebait: z.boolean().optional(),
  filterHateSpeech: z.boolean().optional(),
  filterRacism: z.boolean().optional(),
  filterVaguePosting: z.boolean().optional(),
  filterFearmongering: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      userId,
      filterEngagement,
      filterRagebait,
      filterHateSpeech,
      filterRacism,
      filterVaguePosting,
      filterFearmongering,
    } =
      updateSettingsSchema.parse(body);

    const user = await authenticateExtensionUser(request, userId);
    if (isAuthErrorResponse(user)) {
      return user;
    }

    const planSnapshot = buildPlanSnapshot(user);

    const wantsAdvancedFilter =
      filterEngagement === true ||
      filterRagebait === true ||
      filterHateSpeech === true ||
      filterRacism === true ||
      filterVaguePosting === true ||
      filterFearmongering === true;

    if (wantsAdvancedFilter && !planSnapshot.featureAccess.advancedFilters) {
      return NextResponse.json(
        {
          error: "Advanced content filters are available on Pro.",
          upgradeRequired: true,
          plan: planSnapshot.plan,
          featureAccess: planSnapshot.featureAccess,
        },
        { status: 403 }
      );
    }

    const updated = await prisma.extensionUser.update({
      where: { id: userId },
      data: {
        filterEngagement,
        filterRagebait,
        filterHateSpeech,
        filterRacism,
        filterVaguePosting,
        filterFearmongering,
      },
    });

    return NextResponse.json({
      success: true,
      user: updated,
      plan: planSnapshot.plan,
      featureAccess: planSnapshot.featureAccess,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Settings update error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}

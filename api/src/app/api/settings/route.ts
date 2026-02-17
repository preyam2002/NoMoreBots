import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSettingsSchema = z.object({
  userId: z.string(),
  filterEngagement: z.boolean().optional(),
  filterRagebait: z.boolean().optional(),
  filterHateSpeech: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, filterEngagement, filterRagebait, filterHateSpeech } =
      updateSettingsSchema.parse(body);

    const user = await prisma.extensionUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.extensionUser.update({
      where: { id: userId },
      data: {
        filterEngagement,
        filterRagebait,
        filterHateSpeech,
      },
    });

    return NextResponse.json({ success: true, user: updated });
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

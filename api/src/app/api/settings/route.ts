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

    const user = await prisma.extensionUser.update({
      where: { id: userId },
      data: {
        filterEngagement,
        filterRagebait,
        filterHateSpeech,
      },
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 400 }
    );
  }
}

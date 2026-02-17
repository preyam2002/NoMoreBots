import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const sessionSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
});

export async function POST(request: Request) {
  try {
    const { userId, sessionId } = sessionSchema.parse(await request.json());

    // Verify session was successful
    const user = await prisma.extensionUser.findUnique({
      where: { id: userId },
      select: { id: true, isPremium: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true,
      isPremium: user.isPremium,
      userId: user.id,
    });
  } catch (error) {
    console.error("Verify Error:", error);
    return NextResponse.json(
      { error: "Error verifying session" },
      { status: 500 }
    );
  }
}

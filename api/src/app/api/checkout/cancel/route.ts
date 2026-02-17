import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const cancelSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
});

export async function POST(request: Request) {
  try {
    const { userId, sessionId } = cancelSchema.parse(await request.json());

    // Verify user exists
    const user = await prisma.extensionUser.findUnique({
      where: { id: userId },
      select: { id: true, isPremium: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true,
      message: "Checkout cancelled",
    });
  } catch (error) {
    console.error("Cancel Error:", error);
    return NextResponse.json(
      { error: "Error cancelling checkout" },
      { status: 500 }
    );
  }
}

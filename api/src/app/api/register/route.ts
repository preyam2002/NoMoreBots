import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPlanSnapshot } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { generateClientToken, hashClientToken } from "@/lib/auth";

const registerSchema = z.object({
  existingUserId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = registerSchema.safeParse(await request.json().catch(() => ({})));

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid registration request", details: parsed.error.errors },
        { status: 400 }
      );
    }

    const requestedUserId = parsed.data.existingUserId?.trim();
    const clientToken = generateClientToken();
    const clientTokenHash = hashClientToken(clientToken);

    let user = requestedUserId
      ? await prisma.extensionUser.findUnique({
          where: { id: requestedUserId },
        })
      : null;

    if (user?.clientTokenHash) {
      return NextResponse.json(
        { error: "User is already registered on another client" },
        { status: 409 }
      );
    }

    if (user) {
      user = await prisma.extensionUser.update({
        where: { id: user.id },
        data: { clientTokenHash },
      });
    } else {
      user = await prisma.extensionUser.create({
        data: {
          id: requestedUserId || crypto.randomUUID(),
          clientTokenHash,
        },
      });
    }

    const planSnapshot = buildPlanSnapshot(user);

    return NextResponse.json(
      {
        userId: user.id,
        clientToken,
        plan: planSnapshot.plan,
        isPremium: planSnapshot.isPremium,
        featureAccess: planSnapshot.featureAccess,
      },
      { status: requestedUserId ? 200 : 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Failed to register client" },
      { status: 500 }
    );
  }
}

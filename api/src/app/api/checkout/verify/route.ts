import { NextResponse } from "next/server";
import Stripe from "stripe";
import { authenticateExtensionUser, isAuthErrorResponse } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { normalizePlanId } from "@shared/plans";
import { z } from "zod";

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-11-17.clover" as any,
    })
  : null;

const sessionSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
});

export async function POST(request: Request) {
  try {
    const { userId, sessionId } = sessionSchema.parse(await request.json());

    const authenticatedUser = await authenticateExtensionUser(request, userId);
    if (isAuthErrorResponse(authenticatedUser)) {
      return authenticatedUser;
    }

    if (stripe) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const sessionUserId = session.metadata?.userId;
      const paid = session.payment_status === "paid" || session.status === "complete";

      if (sessionUserId !== userId || !paid) {
        return NextResponse.json(
          { error: "Checkout session is not valid for this user" },
          { status: 400 }
        );
      }
    }

    const user = await prisma.extensionUser.findUnique({
      where: { id: userId },
      select: { id: true, isPremium: true, plan: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true,
      isPremium: normalizePlanId(user.plan, user.isPremium) === "PRO",
      plan: normalizePlanId(user.plan, user.isPremium),
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

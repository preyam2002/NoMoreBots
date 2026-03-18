import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { normalizePlanId } from "@shared/plans";

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-11-17.clover" as any,
    })
  : null;

const endpointSecret = env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: Request) {
  if (!stripe || !endpointSecret) {
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 503 }
    );
  }

  const body = await request.text();
  const sig = headers().get("stripe-signature") || "";

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Webhook Error: ${message}` },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const selectedPlan = normalizePlanId(session.metadata?.plan, true);

    if (userId) {
      try {
        await prisma.extensionUser.upsert({
          where: { id: userId },
          update: {
            isPremium: selectedPlan === "PRO",
            plan: selectedPlan,
            planUpdatedAt: new Date(),
          },
          create: {
            id: userId,
            isPremium: selectedPlan === "PRO",
            plan: selectedPlan,
          },
        });
        console.log(`User ${userId} upgraded to ${selectedPlan}`);
      } catch (error) {
        console.error(`Error upgrading user ${userId}:`, error);
        return NextResponse.json(
          { error: "Failed to update user" },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ received: true });
}

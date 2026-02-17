import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
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

    if (userId) {
      try {
        const user = await prisma.extensionUser.findUnique({
          where: { id: userId },
        });

        if (user) {
          await prisma.extensionUser.update({
            where: { id: userId },
            data: { isPremium: true },
          });
          console.log(`User ${userId} upgraded to premium`);
        } else {
          console.warn(`User ${userId} not found for premium upgrade`);
        }
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

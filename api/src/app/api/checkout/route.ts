import { NextResponse } from "next/server";
import Stripe from "stripe";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    })
  : null;

const PREMIUM_PRICE_ID = env.STRIPE_PRICE_ID;

export async function POST(request: Request) {
  try {
    if (!stripe) {
      return NextResponse.json(
        { error: "Payment system not configured" },
        { status: 503 }
      );
    }

    const { userId, priceId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // Verify user exists
    const user = await prisma.extensionUser.findUnique({
      where: { id: userId },
      select: { id: true, isPremium: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.isPremium) {
      return NextResponse.json({ error: "Already premium" }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // Create checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      mode: "payment",
      success_url: `${appUrl}/dashboard?userId=${userId}&payment=success`,
      cancel_url: `${appUrl}/dashboard?userId=${userId}&payment=cancelled`,
      metadata: { userId },
      billing_address_collection: "auto",
      customer_email: undefined,
      line_items: [],
    };

    // Use price ID if provided, otherwise use ad-hoc price
    if (PREMIUM_PRICE_ID && priceId === PREMIUM_PRICE_ID) {
      sessionParams.line_items = [
        {
          price: PREMIUM_PRICE_ID,
          quantity: 1,
        },
      ];
    } else {
      sessionParams.line_items = [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "AI Tweet Filter Premium",
              description: "Unlimited AI classifications with priority support",
              images: [`${appUrl}/icon-192.png`],
          },
          unit_amount: 999, // $9.99
          quantity: 1,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ 
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Stripe Error:", error);
    return NextResponse.json(
      { error: "Error creating checkout session" },
      { status: 500 }
    );
  }
}

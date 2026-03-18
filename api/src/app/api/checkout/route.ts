import { NextResponse } from "next/server";
import Stripe from "stripe";
import { authenticateExtensionUser, CLIENT_TOKEN_HEADER, isAuthErrorResponse } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getPlanDefinition, normalizePlanId, type PlanId } from "@shared/plans";

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-11-17.clover" as any,
    })
  : null;

const PRO_PRICE_ID = env.STRIPE_PRO_PRICE_ID || env.STRIPE_PRICE_ID;

export async function POST(request: Request) {
  try {
    if (!stripe) {
      return NextResponse.json(
        { error: "Payment system not configured" },
        { status: 503 }
      );
    }

    const { userId, priceId, plan } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const clientToken = request.headers.get(CLIENT_TOKEN_HEADER);
    if (!clientToken) {
      return NextResponse.json({ error: "Missing client token" }, { status: 401 });
    }

    const authenticatedUser = await authenticateExtensionUser(request, userId);
    if (isAuthErrorResponse(authenticatedUser)) {
      return authenticatedUser;
    }

    const selectedPlan = normalizePlanId(plan);
    if (selectedPlan !== "PRO") {
      return NextResponse.json(
        { error: "Only paid plans require checkout" },
        { status: 400 }
      );
    }

    // Verify user exists
    const user = await prisma.extensionUser.findUnique({
      where: { id: userId },
      select: { id: true, isPremium: true, plan: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (normalizePlanId(user.plan, user.isPremium) === "PRO") {
      return NextResponse.json({ error: "Already on Pro" }, { status: 400 });
    }

    const appUrl = env.NEXT_PUBLIC_APP_URL;
    const planDefinition = getPlanDefinition(selectedPlan);

    // Create checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      mode: "payment",
      success_url: `${appUrl}/dashboard?userId=${encodeURIComponent(userId)}&payment=success#clientToken=${encodeURIComponent(clientToken)}`,
      cancel_url: `${appUrl}/dashboard?userId=${encodeURIComponent(userId)}&payment=cancelled#clientToken=${encodeURIComponent(clientToken)}`,
      metadata: { userId, plan: selectedPlan },
      client_reference_id: userId,
      billing_address_collection: "auto",
      customer_email: undefined,
      allow_promotion_codes: true,
      line_items: [],
    };

    // Use price ID if provided, otherwise use ad-hoc price
    if (PRO_PRICE_ID && priceId === PRO_PRICE_ID) {
      sessionParams.line_items = [
        {
          price: PRO_PRICE_ID,
          quantity: 1,
        },
      ];
    } else {
      sessionParams.line_items = [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `NoMoreBots ${planDefinition.name}`,
              description: "Unlock advanced filters, LinkedIn scanning, and provider selection",
            },
            unit_amount: 999,
          },
          quantity: 1,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ 
      url: session.url,
      sessionId: session.id,
      plan: selectedPlan as PlanId,
    });
  } catch (error) {
    console.error("Stripe Error:", error);
    return NextResponse.json(
      { error: "Error creating checkout session" },
      { status: 500 }
    );
  }
}

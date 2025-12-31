import { NextResponse } from "next/server";
import Stripe from "stripe";
import { env } from "@/lib/env";

// Initialize Stripe (we'll need to add the key to env.ts later)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

export async function POST(request: Request) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "AI Tweet Filter Premium",
              description: "Unlimited AI classifications",
            },
            unit_amount: 500, // $5.00
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "https://x.com?payment=success", // Redirect back to X
      cancel_url: "https://x.com?payment=cancelled",
      metadata: {
        userId: userId, // Pass userId to webhook
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Error:", error);
    return NextResponse.json(
      { error: "Error creating checkout session" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const checks: { name: string; status: "ok" | "error"; required: boolean }[] = [
      { name: "api", status: "ok", required: true },
    ];

    const aiConfigured =
      !!env.OPENAI_API_KEY || !!env.ANTHROPIC_API_KEY || !!env.GEMINI_API_KEY;
    checks.push({
      name: "aiProviders",
      status: aiConfigured ? "ok" : "error",
      required: true,
    });

    const paymentsConfigured =
      !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET;
    checks.push({
      name: "payments",
      status: paymentsConfigured ? "ok" : "error",
      required: false,
    });

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.push({ name: "database", status: "ok", required: true });
    } catch {
      checks.push({ name: "database", status: "error", required: true });
    }

    const allOk = checks.every((c) => !c.required || c.status === "ok");

    return NextResponse.json(
      {
        status: allOk ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        checks: Object.fromEntries(checks.map((c) => [c.name, c.status])),
        appUrl: env.NEXT_PUBLIC_APP_URL,
      },
      { status: allOk ? 200 : 503 }
    );
  } catch {
    return NextResponse.json(
      { status: "error", message: "Health check failed" },
      { status: 500 }
    );
  }
}

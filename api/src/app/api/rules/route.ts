import { NextResponse } from "next/server";
import { authenticateExtensionUser, isAuthErrorResponse } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPlanSnapshot } from "@/lib/plans";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ruleSchema = z.object({
  userId: z.string(),
  type: z.enum(["WHITELIST", "BLACKLIST", "KEYWORD", "GEO_BLOCK"]),
  value: z.string().min(1),
});

// GET: List rules for a user
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const user = await authenticateExtensionUser(request, userId);
  if (isAuthErrorResponse(user)) {
    return user;
  }

  const planSnapshot = buildPlanSnapshot(user);
  const rules = await prisma.userRule.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    rules,
    plan: planSnapshot.plan,
    featureAccess: planSnapshot.featureAccess,
    maxRules: planSnapshot.featureAccess.maxRules,
  });
}

// POST: Add a rule
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, type, value } = ruleSchema.parse(body);

    // Clean value (remove @ from handles, lowercase keywords and regions)
    const cleanValue =
      type === "KEYWORD" || type === "GEO_BLOCK"
        ? value.trim().toLowerCase()
        : value.trim().replace(/^@/, "").toLowerCase();

    if (!cleanValue) {
      return NextResponse.json({ error: "Rule value is required" }, { status: 400 });
    }

    const user = await authenticateExtensionUser(request, userId);
    if (isAuthErrorResponse(user)) {
      return user;
    }

    const planSnapshot = buildPlanSnapshot(user);

    if (type === "GEO_BLOCK" && !planSnapshot.featureAccess.geoRules) {
      return NextResponse.json(
        {
          error: "Geo-blocking is available on Pro.",
          upgradeRequired: true,
          plan: planSnapshot.plan,
          featureAccess: planSnapshot.featureAccess,
        },
        { status: 403 }
      );
    }

    const [existingRule, ruleCount] = await Promise.all([
      prisma.userRule.findFirst({
        where: {
          userId,
          type,
          value: cleanValue,
        },
      }),
      prisma.userRule.count({
        where: { userId },
      }),
    ]);

    if (existingRule) {
      return NextResponse.json({ rule: existingRule, duplicate: true });
    }

    if (ruleCount >= planSnapshot.featureAccess.maxRules) {
      return NextResponse.json(
        {
          error: `Your ${planSnapshot.plan === "FREE" ? "Free" : "Pro"} plan supports up to ${planSnapshot.featureAccess.maxRules} rules.`,
          upgradeRequired: planSnapshot.plan === "FREE",
          plan: planSnapshot.plan,
          featureAccess: planSnapshot.featureAccess,
        },
        { status: 403 }
      );
    }

    const rule = await prisma.userRule.create({
      data: {
        userId,
        type,
        value: cleanValue,
      },
    });
    return NextResponse.json({ rule, plan: planSnapshot.plan });
  } catch (error) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// DELETE: Remove a rule
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id") || searchParams.get("ruleId");
    const userId = searchParams.get("userId"); // Security check

    if (!id || !userId) {
      return NextResponse.json(
        { error: "Missing id or userId" },
        { status: 400 }
      );
    }

    const user = await authenticateExtensionUser(request, userId);
    if (isAuthErrorResponse(user)) {
      return user;
    }

    // Ensure rule belongs to user
    const rule = await prisma.userRule.findUnique({ where: { id } });
    if (!rule || rule.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await prisma.userRule.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error deleting rule" }, { status: 500 });
  }
}

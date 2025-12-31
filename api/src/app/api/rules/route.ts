import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const ruleSchema = z.object({
  userId: z.string(),
  type: z.enum(["WHITELIST", "BLACKLIST", "KEYWORD"]),
  value: z.string().min(1),
});

// GET: List rules for a user
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const rules = await prisma.userRule.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ rules });
}

// POST: Add a rule
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, type, value } = ruleSchema.parse(body);

    // Clean value (remove @ from handles)
    const cleanValue =
      type === "KEYWORD" ? value.toLowerCase() : value.replace("@", "");

    const rule = await prisma.userRule.create({
      data: {
        userId,
        type,
        value: cleanValue,
      },
    });

    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// DELETE: Remove a rule
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const userId = searchParams.get("userId"); // Security check

    if (!id || !userId) {
      return NextResponse.json(
        { error: "Missing id or userId" },
        { status: 400 }
      );
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

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const checks: { name: string; status: "ok" | "error" }[] = [
      { name: "api", status: "ok" },
    ];

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.push({ name: "database", status: "ok" });
    } catch {
      checks.push({ name: "database", status: "error" });
    }

    const allOk = checks.every((c) => c.status === "ok");

    return NextResponse.json(
      {
        status: allOk ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        checks: Object.fromEntries(checks.map((c) => [c.name, c.status])),
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

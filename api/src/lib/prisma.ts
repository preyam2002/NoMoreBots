import { PrismaClient } from "@prisma/client";
import { env } from "./env";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const logOptions =
  env.NODE_ENV === "development"
    ? (["query", "error", "warn"] as ("query" | "error" | "warn")[])
    : (["error"] as ("error")[]);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: logOptions,
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

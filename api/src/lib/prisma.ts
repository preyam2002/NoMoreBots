import { PrismaClient } from "@prisma/client";
import { env } from "./env";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const logOptions =
  env.NODE_ENV === "development"
    ? ["query", "error", "warn"] as const
    : ["error"] as const;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: logOptions,
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

if (env.NODE_ENV !== "test") {
  prisma.$connect()
    .then(() => {
      console.log("[Prisma] Database connected successfully");
    })
    .catch((error) => {
      console.error("[Prisma] Database connection failed:", error);
      process.exit(1);
    });
}

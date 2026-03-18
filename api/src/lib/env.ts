import { z } from "zod";

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "Must be a PostgreSQL connection string"
  );

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function isLocalUrl(value: string) {
  try {
    return LOCAL_HOSTNAMES.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  DIRECT_URL: postgresUrl.optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  STRIPE_PRO_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().default(60),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
}).superRefine((value, ctx) => {
  const hasAiProvider =
    !!value.OPENAI_API_KEY || !!value.ANTHROPIC_API_KEY || !!value.GEMINI_API_KEY;
  const hasStripeConfiguration =
    !!value.STRIPE_SECRET_KEY ||
    !!value.STRIPE_WEBHOOK_SECRET ||
    !!value.STRIPE_PRICE_ID ||
    !!value.STRIPE_PRO_PRICE_ID;

  if (value.NODE_ENV === "production") {
    if (!value.DIRECT_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIRECT_URL"],
        message: "DIRECT_URL is required in production",
      });
    }

    if (!hasAiProvider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: "At least one AI provider key is required in production",
      });
    }

    if (isLocalUrl(value.NEXT_PUBLIC_APP_URL) || !value.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEXT_PUBLIC_APP_URL"],
        message: "NEXT_PUBLIC_APP_URL must be an HTTPS, non-localhost URL in production",
      });
    }
  }

  if (hasStripeConfiguration && !value.STRIPE_SECRET_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STRIPE_SECRET_KEY"],
      message: "STRIPE_SECRET_KEY is required when Stripe is configured",
    });
  }

  if (value.STRIPE_SECRET_KEY && !value.STRIPE_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STRIPE_WEBHOOK_SECRET"],
      message: "STRIPE_WEBHOOK_SECRET is required when Stripe is enabled",
    });
  }

  if (
    value.STRIPE_SECRET_KEY &&
    !value.STRIPE_PRICE_ID &&
    !value.STRIPE_PRO_PRICE_ID
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STRIPE_PRO_PRICE_ID"],
      message: "Provide STRIPE_PRO_PRICE_ID or STRIPE_PRICE_ID when Stripe is enabled",
    });
  }
});

export const env = envSchema.parse(process.env);

export function validateEnv() {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    result.error.errors.forEach((err) => {
      console.error(`  ${err.path.join(".")}: ${err.message}`);
    });
    
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  }
  
  if (env.LOG_LEVEL === "debug") {
    console.log("✅ Environment validated:", {
      NODE_ENV: env.NODE_ENV,
      DATABASE_URL: env.DATABASE_URL ? "***" : "not set",
      DIRECT_URL: env.DIRECT_URL ? "***" : "not set",
      hasOpenAI: !!env.OPENAI_API_KEY,
      hasAnthropic: !!env.ANTHROPIC_API_KEY,
      hasGemini: !!env.GEMINI_API_KEY,
      hasStripe: !!env.STRIPE_SECRET_KEY,
    });
  }
  
  return result.success;
}

export function getMissingEnvVars(): string[] {
  const missing: string[] = [];
  
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (env.NODE_ENV === "production" && !env.DIRECT_URL) {
    missing.push("DIRECT_URL");
  }
  if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) {
    missing.push("At least one AI provider key (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY)");
  }
  if (env.NODE_ENV === "production" && (isLocalUrl(env.NEXT_PUBLIC_APP_URL) || !env.NEXT_PUBLIC_APP_URL.startsWith("https://"))) {
    missing.push("NEXT_PUBLIC_APP_URL must be an HTTPS, non-localhost URL in production");
  }
  
  return missing;
}

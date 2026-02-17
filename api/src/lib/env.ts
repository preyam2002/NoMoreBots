import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().default(60),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
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
  if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) {
    missing.push("At least one AI provider key (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY)");
  }
  
  return missing;
}

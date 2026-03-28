export type PlanId = "FREE" | "PRO";
export type DetectionMode = "blur" | "hide" | "label";
export type SupportedPlatform = "twitter" | "linkedin";
export type AIProvider = "openai" | "gemini" | "anthropic";

export interface PlanFeatureAccess {
  linkedinScanning: boolean;
  providerSelection: boolean;
  advancedFilters: boolean;
  geoRules: boolean;
  advancedAnalytics: boolean;
  detectionModes: DetectionMode[];
  maxRules: number;
  historyLimit: number;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceLabel: string;
  billingLabel: string;
  description: string;
  dailyRequestLimit: number;
  features: PlanFeatureAccess;
  bullets: string[];
}

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  FREE: {
    id: "FREE",
    name: "Free",
    priceLabel: "$0",
    billingLabel: "forever",
    description: "Core AI feed cleanup for Twitter/X with conservative defaults.",
    dailyRequestLimit: 100,
    features: {
      linkedinScanning: false,
      providerSelection: false,
      advancedFilters: false,
      geoRules: false,
      advancedAnalytics: false,
      detectionModes: ["blur"],
      maxRules: 20,
      historyLimit: 25,
    },
    bullets: [
      "Twitter/X scanning",
      "Gemini-backed AI detection",
      "Blur mode",
      "20 manual rules",
      "25 recent history items",
    ],
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    priceLabel: "$9.99",
    billingLabel: "one-time unlock",
    description: "Full filtering controls, more platforms, and deeper visibility.",
    dailyRequestLimit: 10000,
    features: {
      linkedinScanning: true,
      providerSelection: true,
      advancedFilters: true,
      geoRules: true,
      advancedAnalytics: true,
      detectionModes: ["blur", "hide", "label"],
      maxRules: 200,
      historyLimit: 200,
    },
    bullets: [
      "Twitter/X and LinkedIn scanning",
      "Gemini, OpenAI, and Claude selection",
      "Six advanced filters including racism, vague-posting, and fearmongering",
      "Hide and label detection modes",
      "Geo rules and advanced analytics",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["FREE", "PRO"];
export const DEFAULT_PLAN_ID: PlanId = "FREE";
export const DEFAULT_PROVIDER: AIProvider = "gemini";

export const AI_USAGE_SUMMARY = [
  "AI scores each post for how likely it is to be AI-generated or low-quality.",
  "AI also labels engagement farming, ragebait, hate speech, racism, vague posting, and fearmongering when those filters are enabled.",
  "Rules, thresholds, whitelists, blacklists, keyword checks, geo rules, and plan limits are deterministic.",
] as const;

export function normalizePlanId(plan?: string | null, isPremium?: boolean | null): PlanId {
  if (plan === "FREE" || plan === "PRO") {
    return plan;
  }

  return isPremium ? "PRO" : "FREE";
}

export function getPlanDefinition(plan?: string | null, isPremium?: boolean | null): PlanDefinition {
  return PLAN_DEFINITIONS[normalizePlanId(plan, isPremium)];
}

export function isPaidPlan(plan?: string | null, isPremium?: boolean | null): boolean {
  return normalizePlanId(plan, isPremium) === "PRO";
}

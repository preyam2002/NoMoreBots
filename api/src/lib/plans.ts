import {
  AI_USAGE_SUMMARY,
  getPlanDefinition,
  normalizePlanId,
  PLAN_ORDER,
  type PlanFeatureAccess,
  type PlanId,
} from "@shared/plans";

type PlanLikeUser = {
  plan?: string | null;
  isPremium?: boolean | null;
};

export function getUserPlanId(user: PlanLikeUser): PlanId {
  return normalizePlanId(user.plan, user.isPremium);
}

export function getUserFeatureAccess(user: PlanLikeUser): PlanFeatureAccess {
  return getPlanDefinition(user.plan, user.isPremium).features;
}

export function buildPlanSnapshot(user: PlanLikeUser) {
  const planId = getUserPlanId(user);
  const definition = getPlanDefinition(planId);

  return {
    plan: planId,
    isPremium: planId === "PRO",
    dailyLimit: definition.dailyRequestLimit,
    featureAccess: definition.features,
  };
}

export function getAvailablePlans() {
  return PLAN_ORDER.map((planId) => {
    const definition = getPlanDefinition(planId);

    return {
      id: definition.id,
      name: definition.name,
      priceLabel: definition.priceLabel,
      billingLabel: definition.billingLabel,
      description: definition.description,
      bullets: definition.bullets,
    };
  });
}

export function getAiUsageSummary() {
  return AI_USAGE_SUMMARY;
}

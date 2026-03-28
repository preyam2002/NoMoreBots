import {
  DEFAULT_PLAN_ID,
  PLAN_DEFINITIONS,
  type PlanFeatureAccess,
  type PlanId,
} from "../../../shared/plans";
import { fetchWithTimeout } from "./network";

export interface ClientIdentity {
  userId: string;
  clientToken: string;
  plan: PlanId;
  featureAccess: PlanFeatureAccess;
}

const DEFAULT_API_BASE_URL = "http://localhost:3000";
const REGISTER_TIMEOUT_MS = 10000;

function normalizeApiBaseUrl(apiBaseUrl: string) {
  try {
    return new URL(apiBaseUrl).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_API_BASE_URL;
  }
}

export function getDefaultApiBaseUrl() {
  return normalizeApiBaseUrl(
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    DEFAULT_API_BASE_URL
  );
}

export function getClientAuthHeaders(clientToken: string) {
  return {
    "x-client-token": clientToken,
  };
}

export async function ensureClientIdentity(
  apiBaseUrl: string = getDefaultApiBaseUrl()
): Promise<ClientIdentity> {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const stored = await chrome.storage.local.get([
    "userId",
    "clientToken",
    "plan",
    "planFeatures",
  ]);

  if (stored.userId && stored.clientToken) {
    return {
      userId: stored.userId as string,
      clientToken: stored.clientToken as string,
      plan: (stored.plan || DEFAULT_PLAN_ID) as PlanId,
      featureAccess:
        (stored.planFeatures || PLAN_DEFINITIONS[DEFAULT_PLAN_ID].features) as PlanFeatureAccess,
    };
  }

  const response = await fetchWithTimeout(`${normalizedApiBaseUrl}/api/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      stored.userId ? { existingUserId: stored.userId as string } : {}
    ),
  }, REGISTER_TIMEOUT_MS);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to register extension");
  }

  const data = (await response.json()) as {
    userId: string;
    clientToken: string;
    plan?: PlanId;
    featureAccess?: PlanFeatureAccess;
  };

  const identity = {
    userId: data.userId,
    clientToken: data.clientToken,
    plan: data.plan || DEFAULT_PLAN_ID,
    featureAccess:
      data.featureAccess || PLAN_DEFINITIONS[data.plan || DEFAULT_PLAN_ID].features,
  };

  await chrome.storage.local.set({
    userId: identity.userId,
    clientToken: identity.clientToken,
    plan: identity.plan,
    planFeatures: identity.featureAccess,
  });

  return identity;
}

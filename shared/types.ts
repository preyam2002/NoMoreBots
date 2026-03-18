import type {
  AIProvider,
  DetectionMode,
  PlanDefinition,
  PlanFeatureAccess,
  PlanId,
  SupportedPlatform,
} from "./plans";
import type { AdvancedFilterState, ClassificationLabel } from "./filters";

export interface TweetData {
  id: string;
  text: string;
  authorHandle: string;
  context?: string; // Parent tweet text or surrounding conversation context
  quotedText?: string;
  mediaSummary?: string;
  isReply?: boolean;
  platform?: SupportedPlatform;
}

export interface BatchClassificationRequest {
  tweets: TweetData[];
}

export interface TweetClassification {
  tweetId: string;
  aiProbability: number;
  label: ClassificationLabel;
  reason: string;
  provider?: AIProvider;
}

export interface UsageSnapshot {
  requestCount: number;
  dailyLimit: number;
  remaining: number;
}

export interface AvailablePlanSummary extends Pick<PlanDefinition, "id" | "name" | "priceLabel" | "billingLabel" | "description" | "bullets"> {}

export interface UserPlanSnapshot {
  plan: PlanId;
  isPremium: boolean;
  featureAccess: PlanFeatureAccess;
}

export interface BatchClassificationResponse {
  results: TweetClassification[];
  usage?: UsageSnapshot;
  plan?: PlanId;
  isPremium?: boolean;
  featureAccess?: PlanFeatureAccess;
}

export interface ExtensionPlanState extends UserPlanSnapshot {
  detectionMode: DetectionMode;
}

export interface StatsResponse extends UserPlanSnapshot, AdvancedFilterState {
  scanned: number;
  hidden: number;
  requestCount: number;
  dailyLimit: number;
  aiUsage: readonly string[];
  availablePlans: AvailablePlanSummary[];
}

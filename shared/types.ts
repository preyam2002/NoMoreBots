export interface TweetData {
  id: string;
  text: string;
  authorHandle: string;
  context?: string; // Parent tweet text
}

export interface BatchClassificationRequest {
  tweets: TweetData[];
}

export interface TweetClassification {
  tweetId: string;
  aiProbability: number;
  label: "ai" | "human";
  reason: string;
  provider?: string;
}

export interface BatchClassificationResponse {
  results: TweetClassification[];
  usage?: number; // Request count used
}

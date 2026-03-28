export const ADVANCED_FILTERS = [
  {
    key: "filterEngagement",
    category: "engagement_farming",
    responseLabel: "engagement",
    label: "Engagement Farming",
    shortLabel: "Engagement Farm",
    description:
      "Posts that explicitly ask for likes, replies, retweets, follows, or algorithm-boosting engagement.",
    reasonPrefix: "Filtered: Engagement Farming.",
    promptHint:
      "explicit requests for likes, retweets, replies, follows, or algorithm gaming",
  },
  {
    key: "filterRagebait",
    category: "ragebait",
    responseLabel: "ragebait",
    label: "Ragebait",
    shortLabel: "Ragebait",
    description:
      "Intentionally inflammatory posts designed to trigger outrage, arguments, or angry quote-posts.",
    reasonPrefix: "Filtered: Ragebait.",
    promptHint:
      "intentionally provocative content designed to spark anger, fights, or reactive engagement",
  },
  {
    key: "filterHateSpeech",
    category: "hate_speech",
    responseLabel: "hate_speech",
    label: "Hate Speech",
    shortLabel: "Hate Speech",
    description:
      "Attacks, slurs, dehumanization, or calls for exclusion or harm against protected groups.",
    reasonPrefix: "Filtered: Hate Speech.",
    promptHint:
      "attacks, dehumanization, or hatred toward protected groups, excluding specifically race-targeted content that should be categorized as racism",
  },
  {
    key: "filterRacism",
    category: "racism",
    responseLabel: "racism",
    label: "Racism",
    shortLabel: "Racism",
    description:
      "Race, ethnicity, nationality, or skin-color based hostility, stereotypes, slurs, or exclusion.",
    reasonPrefix: "Filtered: Racism.",
    promptHint:
      "hostility, slurs, stereotyping, or exclusion aimed at race, ethnicity, nationality, or skin color",
  },
  {
    key: "filterVaguePosting",
    category: "vague_posting",
    responseLabel: "vague_posting",
    label: "Vague Posting",
    shortLabel: "Vague Post",
    description:
      "Cryptic grievance posts, subtweets, or drama bait that imply conflict without useful specifics.",
    reasonPrefix: "Filtered: Vague Posting.",
    promptHint:
      "cryptic grievance posting, subtweeting, or drama bait that hints at conflict without saying anything concrete",
  },
  {
    key: "filterFearmongering",
    category: "fearmongering",
    responseLabel: "fearmongering",
    label: "Fearmongering",
    shortLabel: "Fearmongering",
    description:
      "Alarmist posts that exaggerate danger or panic to manipulate attention or emotional response.",
    reasonPrefix: "Filtered: Fearmongering.",
    promptHint:
      "alarmist or panic-inducing claims that exaggerate danger to manipulate attention or emotion",
  },
] as const;

export type FilterSettingKey = (typeof ADVANCED_FILTERS)[number]["key"];
export type ModerationCategory =
  | "normal"
  | (typeof ADVANCED_FILTERS)[number]["category"];
export type FilteredClassificationLabel =
  (typeof ADVANCED_FILTERS)[number]["responseLabel"];
export type ClassificationLabel =
  | "ai"
  | "human"
  | FilteredClassificationLabel
  | "geo_blocked";

export type AdvancedFilterState = Record<FilterSettingKey, boolean>;

export const ADVANCED_FILTER_DEFAULTS: AdvancedFilterState = {
  filterEngagement: false,
  filterRagebait: false,
  filterHateSpeech: false,
  filterRacism: false,
  filterVaguePosting: false,
  filterFearmongering: false,
};

export function getAdvancedFilterByCategory(category: string) {
  return ADVANCED_FILTERS.find((filter) => filter.category === category);
}

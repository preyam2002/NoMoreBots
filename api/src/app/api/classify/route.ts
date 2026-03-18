import { NextResponse } from "next/server";
import { getAdvancedFilterByCategory, type FilterSettingKey } from "@shared/filters";
import { authenticateExtensionUser, isAuthErrorResponse } from "@/lib/auth";
import { classifyTweet } from "@/lib/llm";
import { buildPlanSnapshot } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { rateLimit, getRateLimitStatus, addRateLimitHeaders } from "@/lib/ratelimit";
import { z } from "zod";
import { DEFAULT_PROVIDER, type AIProvider } from "@shared/plans";

const requestSchema = z.object({
  tweets: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().max(1000).default(""),
        authorHandle: z.string().optional().default("unknown"),
        context: z.string().optional(),
        quotedText: z.string().max(1000).optional(),
        mediaSummary: z.string().max(1000).optional(),
        isReply: z.boolean().optional().default(false),
        platform: z.enum(["twitter", "linkedin"]).optional().default("twitter"),
      }).superRefine((tweet, ctx) => {
        const hasMeaningfulContent =
          tweet.text.trim().length > 0 ||
          tweet.context?.trim() ||
          tweet.quotedText?.trim() ||
          tweet.mediaSummary?.trim();

        if (!hasMeaningfulContent) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Tweet must include text, context, quoted text, or media summary",
            path: ["text"],
          });
        }
      })
    )
    .min(1)
    .max(20),
});

interface Rule {
  type: string;
  value: string;
}

interface ClassificationResult {
  tweetId: string;
  aiProbability: number;
  label: string;
  reason: string;
  cached: boolean;
  billable: boolean;
}

function isAdvancedFilterEnabled(
  user: Record<FilterSettingKey, boolean>,
  filterKey: FilterSettingKey
) {
  return user[filterKey] === true;
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const userId = request.headers.get("x-user-id") || undefined;
    const userApiKey = request.headers.get("x-api-key") || undefined;
    const provider = (request.headers.get("x-provider") || DEFAULT_PROVIDER) as AIProvider;

    if (!userId) {
      console.warn(`[${requestId}] Missing userId header`);
      return NextResponse.json(
        { error: "Missing x-user-id header", requestId },
        { status: 400 }
      );
    }

    const limiter = await rateLimit(ip, userId);
    if (!limiter.success) {
      console.warn(`[${requestId}] Rate limit exceeded for ${userId || ip}`);
      return NextResponse.json(
        { error: "Too many requests", requestId },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      console.warn(`[${requestId}] Invalid request body:`, parseResult.error.errors);
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.errors, requestId },
        { status: 400 }
      );
    }

    const { tweets } = parseResult.data;
    const batchSize = tweets.length;

    console.log(
      `[${requestId}] Processing batch of ${batchSize} tweets from user ${userId} using ${provider}`
    );

    // User & Monetization Check
    const useSystemKey = !userApiKey;

    const user = await authenticateExtensionUser(request, userId);
    if (isAuthErrorResponse(user)) {
      return user;
    }

    const planSnapshot = buildPlanSnapshot(user);

    // Reset daily counter if it's a new day
    const now = new Date();
    const isNewDay = now.toDateString() !== user.lastRequest.toDateString();
    let currentRequestCount = user.requestCount;

    if (isNewDay) {
      await prisma.extensionUser.update({
        where: { id: userId },
        data: { requestCount: 0, lastRequest: now },
      });
      currentRequestCount = 0;
    }

    if (provider !== DEFAULT_PROVIDER && !planSnapshot.featureAccess.providerSelection) {
      return NextResponse.json(
        {
          error: "Provider switching is available on Pro.",
          requestId,
          upgradeRequired: true,
          plan: planSnapshot.plan,
          featureAccess: planSnapshot.featureAccess,
        },
        { status: 403 }
      );
    }

    if (
      parseResult.data.tweets.some((tweet) => tweet.platform === "linkedin") &&
      !planSnapshot.featureAccess.linkedinScanning
    ) {
      return NextResponse.json(
        {
          error: "LinkedIn scanning is available on Pro.",
          requestId,
          upgradeRequired: true,
          plan: planSnapshot.plan,
          featureAccess: planSnapshot.featureAccess,
        },
        { status: 403 }
      );
    }

    // Check daily limit for users without their own API key
    if (useSystemKey && currentRequestCount >= planSnapshot.dailyLimit) {
      console.warn(`[${requestId}] Daily limit exceeded for user ${userId}`);
      return NextResponse.json(
        {
          error: "Daily limit reached",
          requestId,
          upgradeRequired: true,
          plan: planSnapshot.plan,
          featureAccess: planSnapshot.featureAccess,
        },
        { status: 402 }
      );
    }

    // Fetch user rules (including GEO_BLOCK)
    const rules = await prisma.userRule.findMany({
      where: { userId },
      select: { type: true, value: true },
    });

    const whitelist = new Set(
      rules.filter((r: Rule) => r.type === "WHITELIST").map((r: Rule) => r.value.toLowerCase())
    );
    const blacklist = new Set(
      rules.filter((r: Rule) => r.type === "BLACKLIST").map((r: Rule) => r.value.toLowerCase())
    );
    const keywords = rules
      .filter((r: Rule) => r.type === "KEYWORD")
      .map((r: Rule) => r.value.toLowerCase());
    const geoBlockRegions = new Set(
      rules.filter((r: Rule) => r.type === "GEO_BLOCK").map((r: Rule) => r.value.toLowerCase())
    );

    // Check cache for all tweets
    const tweetIds = tweets.map((t: { id: string }) => t.id);
    const cachedTweets = await prisma.tweet.findMany({
      where: { id: { in: tweetIds } },
      select: { id: true, aiProbability: true },
    });

    const cachedMap = new Map(
      cachedTweets.map((t: { id: string; aiProbability: number }) => [t.id, t])
    );

    // Separate cached vs uncached
    const uncachedTweets: typeof tweets = [];
    const cachedResults: ClassificationResult[] = [];

    tweets.forEach((tweet) => {
      const cached = cachedMap.get(tweet.id);
      if (cached) {
        cachedResults.push({
          tweetId: tweet.id,
          aiProbability: cached.aiProbability,
          label: cached.aiProbability > 0.75 ? "ai" : "human",
          reason: "Cached result",
          cached: true,
          billable: false,
        });
      } else {
        uncachedTweets.push(tweet);
      }
    });

    // Check geo-block by looking up author location
    const authorHandles = uncachedTweets.map((t) => t.authorHandle).filter((h) => h !== "unknown");
    let authorLocationMap = new Map<string, string>();
    if (geoBlockRegions.size > 0 && authorHandles.length > 0) {
      const authors = await prisma.author.findMany({
        where: { handle: { in: authorHandles } },
        select: { handle: true, location: true },
      });
      authorLocationMap = new Map(
        authors.filter((a) => a.location).map((a) => [a.handle, a.location!.toLowerCase()])
      );
    }

    // Process uncached tweets with LLM
    const llmResults: ClassificationResult[] = await Promise.all(
      uncachedTweets.map(async (tweet) => {
        const handleLower = tweet.authorHandle.toLowerCase();

        // Whitelist check
        if (whitelist.has(handleLower)) {
          return {
            tweetId: tweet.id,
            aiProbability: 0,
            label: "human" as const,
            reason: "User Whitelist",
            cached: true,
            billable: false,
          };
        }

        // Blacklist check
        if (blacklist.has(handleLower)) {
          return {
            tweetId: tweet.id,
            aiProbability: 1,
            label: "ai" as const,
            reason: "User Blacklist",
            cached: true,
            billable: false,
          };
        }

        // Geo-block check
        if (geoBlockRegions.size > 0) {
          const authorLocation = authorLocationMap.get(tweet.authorHandle);
          if (authorLocation) {
            for (const region of Array.from(geoBlockRegions)) {
              if (authorLocation.includes(region)) {
                return {
                  tweetId: tweet.id,
                  aiProbability: 1,
                  label: "geo_blocked" as const,
                  reason: `Geo-blocked: ${authorLocation}`,
                  cached: false,
                  billable: false,
                };
              }
            }
          }
        }

        // Keyword check
        const lowerText = [tweet.text, tweet.mediaSummary].filter(Boolean).join(" ").toLowerCase();
        const matchedKeyword = keywords.find((k) => lowerText.includes(k));
        if (matchedKeyword) {
          return {
            tweetId: tweet.id,
            aiProbability: 1,
            label: "ai" as const,
            reason: `Keyword match: ${matchedKeyword}`,
            cached: true,
            billable: false,
          };
        }

        // LLM Classification
        const { aiProbability, category, reason } = await classifyTweet(
          tweet.text,
          userApiKey || undefined,
          provider,
          {
            context: tweet.context,
            quotedText: tweet.quotedText,
            mediaSummary: tweet.mediaSummary,
            isReply: tweet.isReply,
            platform: tweet.platform,
          }
        );

        // Category Filter Check
        let finalProbability = aiProbability;
        let finalLabel: string = aiProbability > 0.75 ? "ai" : "human";
        let finalReason = reason;

        const matchedAdvancedFilter = getAdvancedFilterByCategory(category);
        if (
          matchedAdvancedFilter &&
          planSnapshot.featureAccess.advancedFilters &&
          isAdvancedFilterEnabled(user as Record<FilterSettingKey, boolean>, matchedAdvancedFilter.key)
        ) {
          finalProbability = 1;
          finalLabel = matchedAdvancedFilter.responseLabel;
          finalReason = `${matchedAdvancedFilter.reasonPrefix} ${reason}`;
        }

        const storedText =
          tweet.text || tweet.mediaSummary || tweet.quotedText || tweet.context || "[No visible text]";

        // Store result
        try {
          await prisma.$transaction(async (tx) => {
            await tx.author.upsert({
              where: { handle: tweet.authorHandle },
              update: {},
              create: { handle: tweet.authorHandle },
            });

            await tx.tweet.create({
              data: {
                id: tweet.id,
                text: storedText,
                authorHandle: tweet.authorHandle,
                aiProbability: finalProbability,
                isHidden: finalProbability > 0.75,
              },
            });

            await tx.classificationLog.create({
              data: {
                tweetId: tweet.id,
                result: {
                  aiProbability: finalProbability,
                  category,
                  reason: finalReason,
                  provider,
                },
              },
            });
          });
        } catch (dbError) {
          console.error(`[${requestId}] DB error storing tweet ${tweet.id}:`, dbError);
        }

        return {
          tweetId: tweet.id,
          aiProbability: finalProbability,
          label: finalLabel,
          reason: finalReason,
          cached: false,
          billable: true,
        };
      })
    );

    // Combine results
    const results = [...cachedResults, ...llmResults];

    // Update stats
    const botsDetected = results.filter((r) => r.aiProbability > 0.75).length;
    const newRequests = llmResults.filter((r) => r.billable).length;
    const updatedRequestCount = currentRequestCount + newRequests;

    await prisma.extensionUser.update({
      where: { id: userId },
      data: {
        requestCount: { increment: newRequests },
        lastRequest: now,
        tweetsScanned: { increment: batchSize },
        botsBlocked: { increment: botsDetected },
        isPremium: planSnapshot.isPremium,
        plan: planSnapshot.plan,
      },
    });

    const duration = Date.now() - startTime;
    console.log(
      `[${requestId}] Completed in ${duration}ms: ${batchSize} tweets, ${botsDetected} bots, ${newRequests} new requests`
    );

    const response = NextResponse.json({
      results: results.map(({ billable, ...result }) => result),
      requestId,
      plan: planSnapshot.plan,
      isPremium: planSnapshot.isPremium,
      featureAccess: planSnapshot.featureAccess,
      usage: {
        requestCount: updatedRequestCount,
        dailyLimit: planSnapshot.dailyLimit,
        remaining: Math.max(0, planSnapshot.dailyLimit - updatedRequestCount),
      },
    });
    const rateLimitStatus = await getRateLimitStatus(ip, userId);
    addRateLimitHeaders(response, rateLimitStatus);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${requestId}] API Error after ${duration}ms:`, error);
    return NextResponse.json(
      { error: "Internal Server Error", requestId },
      { status: 500 }
    );
  }
}

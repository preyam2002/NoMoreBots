import { NextResponse } from "next/server";
import { classifyTweet } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { rateLimit, addRateLimitHeaders } from "@/lib/ratelimit";
import { z } from "zod";

const requestSchema = z.object({
  tweets: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1).max(1000),
        authorHandle: z.string().optional().default("unknown"),
        context: z.string().optional(),
      })
    )
    .min(1)
    .max(20),
});

interface Rule {
  type: string;
  value: string;
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const limiter = rateLimit(ip);
    if (!limiter.success) {
      console.warn(`[${requestId}] Rate limit exceeded for IP: ${ip}`);
      const response = NextResponse.json(
        { error: "Too many requests", requestId },
        { status: 429 }
      );
      return response;
    }

    const userId = request.headers.get("x-user-id") || undefined;
    const userApiKey = request.headers.get("x-api-key") || undefined;
    const provider = request.headers.get("x-provider") || "google";

    if (!userId) {
      console.warn(`[${requestId}] Missing userId header`);
      return NextResponse.json(
        { error: "Missing x-user-id header", requestId },
        { status: 400 }
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

    // 3. User & Monetization Check
    const useSystemKey = !userApiKey;

    // Fetch user with preference flags
    const user = await prisma.extensionUser.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
      select: {
        id: true,
        isPremium: true,
        requestCount: true,
        filterEngagement: true,
        filterRagebait: true,
        filterHateSpeech: true,
      },
    });

    // Check daily limit for non-premium users without their own API key
    const FREE_DAILY_LIMIT = 100;
    if (useSystemKey && !user.isPremium && user.requestCount >= FREE_DAILY_LIMIT) {
      console.warn(`[${requestId}] Daily limit exceeded for user ${userId}`);
      return NextResponse.json(
        { error: "Daily limit reached", requestId, upgradeRequired: true },
        { status: 402 }
      );
    }

    // 4. Fetch user rules
    const rules = await prisma.userRule.findMany({
      where: { userId },
      select: { type: true, value: true },
    });

    const whitelist = new Set(
      rules.filter((r: Rule) => r.type === "WHITELIST").map((r: Rule) => r.value)
    );
    const blacklist = new Set(
      rules.filter((r: Rule) => r.type === "BLACKLIST").map((r: Rule) => r.value)
    );
    const keywords = rules
      .filter((r: Rule) => r.type === "KEYWORD")
      .map((r: Rule) => r.value);

    // Pre-compute sets for faster lookup
    const tweetIds = new Set(tweets.map((t: { id: string }) => t.id));

    // 5. Check cache for all tweets
    const cachedTweets = await prisma.tweet.findMany({
      where: { id: { in: Array.from(tweetIds) } },
      select: { id: true, aiProbability: true },
    });

    const cachedMap = new Map(
      cachedTweets.map((t: { id: string; aiProbability: number }) => [t.id, t])
    );

    // Separate cached vs uncached
    const uncachedTweets: typeof tweets = [];
    const cachedResults: ReturnType<typeof classifyTweet>[] = [];

    tweets.forEach((tweet: { id: string; authorHandle: string; text: string }) => {
      const cached = cachedMap.get(tweet.id);
      if (cached) {
        cachedResults.push({
          tweetId: tweet.id,
          aiProbability: cached.aiProbability,
          label: cached.aiProbability > 0.75 ? "ai" : "human",
          reason: "Cached result",
          cached: true,
        });
      } else {
        uncachedTweets.push(tweet);
      }
    });

    // 6. Process uncached tweets with LLM
    const llmResults = await Promise.all(
      uncachedTweets.map(async (tweet) => {
        // Rule Check (Pre-LLM)
        if (whitelist.has(tweet.authorHandle)) {
          return {
            tweetId: tweet.id,
            aiProbability: 0,
            label: "human" as const,
            reason: "User Whitelist",
            cached: true,
          };
        }

        if (blacklist.has(tweet.authorHandle)) {
          return {
            tweetId: tweet.id,
            aiProbability: 1,
            label: "ai" as const,
            reason: "User Blacklist",
            cached: true,
          };
        }

        const lowerText = tweet.text.toLowerCase();
        const matchedKeyword = keywords.find((k) => lowerText.includes(k));
        if (matchedKeyword) {
          return {
            tweetId: tweet.id,
            aiProbability: 1,
            label: "ai" as const,
            reason: `Keyword match: ${matchedKeyword}`,
            cached: true,
          };
        }

        // LLM Classification
        const { aiProbability, category, reason } = await classifyTweet(
          tweet.text,
          userApiKey || undefined,
          provider,
          tweet.context
        );

        // Category Filter Check
        let finalProbability = aiProbability;
        let finalLabel: "ai" | "human" | "engagement" | "ragebait" | "hate_speech" =
          aiProbability > 0.75 ? "ai" : "human";
        let finalReason = reason;

        if (category === "engagement_farming" && user.filterEngagement) {
          finalProbability = 1;
          finalLabel = "engagement";
          finalReason = `Filtered: Engagement Farming. ${reason}`;
        } else if (category === "ragebait" && user.filterRagebait) {
          finalProbability = 1;
          finalLabel = "ragebait";
          finalReason = `Filtered: Ragebait. ${reason}`;
        } else if (category === "hate_speech" && user.filterHateSpeech) {
          finalProbability = 1;
          finalLabel = "hate_speech";
          finalReason = `Filtered: Hate Speech. ${reason}`;
        }

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
                text: tweet.text,
                authorHandle: tweet.authorHandle,
                aiProbability: finalProbability,
                isHidden: finalProbability > 0.75,
              },
            });

            await tx.classificationLog.create({
              data: {
                tweetId: tweet.id,
                result: JSON.stringify({
                  aiProbability: finalProbability,
                  category,
                  reason: finalReason,
                  provider,
                }),
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
        };
      })
    );

    // 7. Combine results
    const results = [...cachedResults, ...llmResults];

    // 8. Update stats
    const botsDetected = results.filter((r) => r.aiProbability > 0.75).length;
    const newRequests = uncachedTweets.length - llmResults.filter((r) => r.cached).length;

    await prisma.extensionUser.update({
      where: { id: userId },
      data: {
        requestCount: { increment: newRequests },
        tweetsScanned: { increment: batchSize },
        botsBlocked: { increment: botsDetected },
      },
    });

    const duration = Date.now() - startTime;
      console.log(
        `[${requestId}] Completed in ${duration}ms: ${batchSize} tweets, ${botsDetected} bots, ${newRequests} new requests`
      );

      const response = NextResponse.json({ results, requestId });
      const status = rateLimit(ip);
      if (status.remaining !== undefined) {
        addRateLimitHeaders(response, {
          remaining: status.remaining,
          limit: status.limit,
          resetTime: status.resetTime,
        });
      }
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

import { NextResponse } from "next/server";
import { classifyTweet } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/ratelimit";
import { z } from "zod";

const requestSchema = z.object({
  tweets: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().min(1).max(1000),
        authorHandle: z.string().optional().default("unknown"),
        context: z.string().optional(),
      })
    )
    .min(1)
    .max(20), // Limit batch size
});

export async function POST(request: Request) {
  try {
    // 1. Rate Limiting
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const limiter = rateLimit(ip);
    if (!limiter.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // 2. Validation & Auth
    const userId = request.headers.get("x-user-id");
    const userApiKey =
      request.headers.get("x-api-key") || request.headers.get("x-openai-key");
    const provider = (request.headers.get("x-provider") || "gemini") as
      | "openai"
      | "gemini"
      | "anthropic";

    if (!userId) {
      return NextResponse.json(
        { error: "Missing x-user-id header" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error },
        { status: 400 }
      );
    }

    const { tweets } = parseResult.data;
    const batchSize = tweets.length;
    console.log(
      `[API] Received batch of ${batchSize} tweets from user ${userId}`
    );

    // 3. User & Monetization Check
    let useSystemKey = true;
    if (userApiKey) {
      useSystemKey = false;
    }

    // Always fetch/create user to get preferences and track stats
    const user = await prisma.extensionUser.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });

    if (!useSystemKey) {
      // User provided key, no limit check needed
    } else {
      // Limit check removed per user request
    }

    // Fetch user rules
    const rules = await prisma.userRule.findMany({
      where: { userId },
    });

    const whitelist = new Set(
      rules
        .filter((r: { type: string; value: string }) => r.type === "WHITELIST")
        .map((r: { value: string }) => r.value)
    );
    const blacklist = new Set(
      rules
        .filter((r: { type: string; value: string }) => r.type === "BLACKLIST")
        .map((r: { value: string }) => r.value)
    );
    const keywords = rules
      .filter((r: { type: string; value: string }) => r.type === "KEYWORD")
      .map((r: { value: string }) => r.value);

    // Process batch
    const results = await Promise.all(
      tweets.map(async (tweet) => {
        // 3.5 Rule Check (Pre-LLM)
        if (whitelist.has(tweet.authorHandle)) {
          return {
            tweetId: tweet.id,
            aiProbability: 0,
            label: "human",
            reason: "User Whitelist",
            cached: true, // Treated as cached/instant
          };
        }

        if (blacklist.has(tweet.authorHandle)) {
          return {
            tweetId: tweet.id,
            aiProbability: 1,
            label: "ai",
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
            label: "ai",
            reason: `Keyword match: ${matchedKeyword}`,
            cached: true,
          };
        }

        // 4. Cache Check (DB)
        const existing = await prisma.tweet.findUnique({
          where: { id: tweet.id },
        });

        if (existing) {
          return {
            tweetId: tweet.id,
            aiProbability: existing.aiProbability,
            label: existing.aiProbability > 0.75 ? "ai" : "human",
            reason: "Cached result",
            cached: true,
          };
        }

        // 5. LLM Classification
        const { aiProbability, category, reason } = await classifyTweet(
          tweet.text,
          userApiKey || undefined,
          provider,
          tweet.context
        );

        // 5.5 Category Filter Check
        let finalProbability = aiProbability;
        let finalLabel = aiProbability > 0.75 ? "ai" : "human";
        let finalReason = reason;

        // We need to fetch the user again or ensure we have the flags.
        // The 'user' object from upsert above might not have the latest flags if we didn't select them or if it was a create.
        // Actually, upsert returns the object. We should ensure we have the flags.
        // For simplicity, let's assume 'user' has them (Prisma returns all fields by default).

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

        // 6. Store Result
        await prisma.$transaction(async (tx) => {
          // Ensure author exists
          await tx.author.upsert({
            where: { handle: tweet.authorHandle },
            update: {},
            create: { handle: tweet.authorHandle },
          });

          // Create tweet
          await tx.tweet.create({
            data: {
              id: tweet.id,
              text: tweet.text,
              authorHandle: tweet.authorHandle,
              aiProbability: finalProbability,
              isHidden: finalProbability > 0.75,
            },
          });

          // Log classification
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

        return {
          tweetId: tweet.id,
          aiProbability: finalProbability,
          label: finalLabel,
          reason: finalReason,
          cached: false,
        };
      })
    );

    // Increment usage count for the whole batch
    if (useSystemKey) {
      // Only increment for non-cached? Or all?
      // Usually we charge for the service, but if cached, it costs us nothing.
      // Let's be nice and only charge for non-cached LLM calls?
      // For now, simple logic: charge for all to prevent abuse of cache lookup?
      // Let's charge for all to keep it simple, or maybe only non-cached.
      // Let's charge for all for now as "requests processed".
      await prisma.extensionUser.update({
        where: { id: userId },
        data: { requestCount: { increment: batchSize } },
      });
    }

    // 7. Update User Stats
    const botsDetected = results.filter((r) => r.aiProbability > 0.75).length;
    await prisma.extensionUser.update({
      where: { id: userId },
      data: {
        tweetsScanned: { increment: tweets.length },
        botsBlocked: { increment: botsDetected },
        // requestCount is already incremented above if useSystemKey is true
        // If useSystemKey is false (user provided key), we might not want to increment requestCount?
        // Actually, requestCount is for the daily limit. If they use their own key, they bypass the limit.
        // So we only increment requestCount if they are using our system key (free tier).
      },
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

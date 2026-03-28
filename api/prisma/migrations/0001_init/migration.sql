-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "UserRuleType" AS ENUM ('WHITELIST', 'BLACKLIST', 'KEYWORD', 'GEO_BLOCK');

-- CreateTable
CREATE TABLE "Tweet" (
    "id" TEXT NOT NULL,
    "authorHandle" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "aiProbability" DOUBLE PRECISION NOT NULL,
    "isHidden" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tweet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Author" (
    "handle" TEXT NOT NULL,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("handle")
);

-- CreateTable
CREATE TABLE "ClassificationLog" (
    "id" TEXT NOT NULL,
    "tweetId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionUser" (
    "id" TEXT NOT NULL,
    "clientTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "planUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "lastRequest" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tweetsScanned" INTEGER NOT NULL DEFAULT 0,
    "botsBlocked" INTEGER NOT NULL DEFAULT 0,
    "filterEngagement" BOOLEAN NOT NULL DEFAULT false,
    "filterRagebait" BOOLEAN NOT NULL DEFAULT false,
    "filterHateSpeech" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExtensionUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "UserRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UserRuleType" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tweet_authorHandle_idx" ON "Tweet"("authorHandle");

-- CreateIndex
CREATE INDEX "Tweet_createdAt_idx" ON "Tweet"("createdAt");

-- CreateIndex
CREATE INDEX "Tweet_isHidden_createdAt_idx" ON "Tweet"("isHidden", "createdAt");

-- CreateIndex
CREATE INDEX "ClassificationLog_tweetId_timestamp_idx" ON "ClassificationLog"("tweetId", "timestamp");

-- CreateIndex
CREATE INDEX "ExtensionUser_plan_idx" ON "ExtensionUser"("plan");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionUser_clientTokenHash_key" ON "ExtensionUser"("clientTokenHash");

-- CreateIndex
CREATE INDEX "RateLimitBucket_updatedAt_idx" ON "RateLimitBucket"("updatedAt");

-- CreateIndex
CREATE INDEX "UserRule_userId_idx" ON "UserRule"("userId");

-- CreateIndex
CREATE INDEX "UserRule_userId_type_idx" ON "UserRule"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "UserRule_userId_type_value_key" ON "UserRule"("userId", "type", "value");

-- AddForeignKey
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_authorHandle_fkey" FOREIGN KEY ("authorHandle") REFERENCES "Author"("handle") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRule" ADD CONSTRAINT "UserRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ExtensionUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

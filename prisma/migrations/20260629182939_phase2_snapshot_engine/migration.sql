-- CreateTable
CREATE TABLE "CollectorRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "dateMode" TEXT NOT NULL,
    "rawJson" TEXT
);

-- CreateTable
CREATE TABLE "AccountSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "accountName" TEXT,
    "customerId" TEXT,
    "keyword" TEXT NOT NULL,
    "refreshed" BOOLEAN NOT NULL,
    "filterChipFound" BOOLEAN NOT NULL,
    "visibleRowCount" INTEGER NOT NULL,
    "totalFilteredRows" INTEGER NOT NULL,
    "campaignsCollected" INTEGER NOT NULL,
    "campaignsMissing" INTEGER NOT NULL,
    "reason" TEXT,
    "screenshotPath" TEXT,
    "fromDate" TEXT,
    "toDate" TEXT,
    "googleAdsDateLabel" TEXT,
    CONSTRAINT "AccountSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollectorRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountSnapshotId" INTEGER NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "campaignName" TEXT,
    "budget" TEXT,
    "status" TEXT,
    "optimizationScore" TEXT,
    "account" TEXT,
    "campaignType" TEXT,
    "impressions" TEXT,
    "interactions" TEXT,
    "interactionRate" TEXT,
    "avgCost" TEXT,
    "cost" TEXT,
    "conversions" TEXT,
    CONSTRAINT "CampaignSnapshot_accountSnapshotId_fkey" FOREIGN KEY ("accountSnapshotId") REFERENCES "AccountSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AccountSnapshot_runId_idx" ON "AccountSnapshot"("runId");

-- CreateIndex
CREATE INDEX "CampaignSnapshot_accountSnapshotId_idx" ON "CampaignSnapshot"("accountSnapshotId");

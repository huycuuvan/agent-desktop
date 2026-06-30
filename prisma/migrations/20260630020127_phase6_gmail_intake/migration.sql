-- CreateTable
CREATE TABLE "gmail_invitation_intake_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "requestedCustomerId" TEXT NOT NULL,
    "normalizedCustomerId" TEXT,
    "gmailMessageSubject" TEXT,
    "gmailMatchedCustomerId" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "acceptUrl" TEXT,
    "adspowerProfileId" TEXT,
    "screenshotPath" TEXT
);

-- CreateIndex
CREATE INDEX "gmail_invitation_intake_logs_normalizedCustomerId_idx" ON "gmail_invitation_intake_logs"("normalizedCustomerId");

-- CreateIndex
CREATE INDEX "gmail_invitation_intake_logs_status_idx" ON "gmail_invitation_intake_logs"("status");

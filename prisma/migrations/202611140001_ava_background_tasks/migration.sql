CREATE TABLE "AiTask" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerUsername" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT NOT NULL DEFAULT 'Queued',
    "errorMessage" TEXT,
    "resultDocumentId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiTask_ownerId_createdAt_idx" ON "AiTask"("ownerId", "createdAt");
CREATE INDEX "AiTask_status_availableAt_createdAt_idx" ON "AiTask"("status", "availableAt", "createdAt");
CREATE INDEX "AiTask_resultDocumentId_idx" ON "AiTask"("resultDocumentId");

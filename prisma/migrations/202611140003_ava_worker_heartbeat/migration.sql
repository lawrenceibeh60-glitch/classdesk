CREATE TABLE "AiWorkerState" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiWorkerState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiWorkerState_lastSeenAt_idx" ON "AiWorkerState"("lastSeenAt");

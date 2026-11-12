CREATE TABLE "AiRequestReceipt" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRequestReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiRequestReceipt_createdAt_idx" ON "AiRequestReceipt"("createdAt");

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "lastClassifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClassificationRun" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "atendimentoId" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "incremental" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassificationRun_conversationId_idx" ON "ClassificationRun"("conversationId");

-- CreateIndex
CREATE INDEX "ClassificationRun_atendimentoId_idx" ON "ClassificationRun"("atendimentoId");

-- CreateIndex
CREATE INDEX "ClassificationRun_createdAt_idx" ON "ClassificationRun"("createdAt");

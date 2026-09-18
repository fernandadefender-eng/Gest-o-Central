-- CreateTable
CREATE TABLE "PedidoAprovacao" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "solicitante" TEXT NOT NULL,
    "alvoId" TEXT,
    "alvoDescricao" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "motivos" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "decididoPor" TEXT,
    "decididoEm" TIMESTAMP(3),
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedidoAprovacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PedidoAprovacao_status_criadoEm_idx" ON "PedidoAprovacao"("status", "criadoEm");

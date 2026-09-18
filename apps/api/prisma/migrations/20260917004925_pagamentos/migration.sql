-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN     "pagoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" TEXT NOT NULL,
    "prestadorNome" TEXT NOT NULL,
    "providerId" TEXT,
    "regiao" TEXT,
    "cidade" TEXT,
    "cliente" TEXT,
    "conta" TEXT,
    "valor" DECIMAL(10,2),
    "regime" TEXT,
    "pagoEm" TIMESTAMP(3),
    "arquivo" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "grupo" TEXT,
    "autor" TEXT,
    "chave" TEXT NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL,
    "textoOriginal" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagamentoAtendimento" (
    "id" TEXT NOT NULL,
    "pagamentoId" TEXT NOT NULL,
    "atendimentoId" TEXT,
    "idPR7" TEXT NOT NULL,
    "valor" DECIMAL(10,2),

    CONSTRAINT "PagamentoAtendimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_chave_key" ON "Pagamento"("chave");

-- CreateIndex
CREATE INDEX "Pagamento_prestadorNome_idx" ON "Pagamento"("prestadorNome");

-- CreateIndex
CREATE INDEX "Pagamento_pagoEm_idx" ON "Pagamento"("pagoEm");

-- CreateIndex
CREATE INDEX "Pagamento_recebidoEm_idx" ON "Pagamento"("recebidoEm");

-- CreateIndex
CREATE INDEX "PagamentoAtendimento_idPR7_idx" ON "PagamentoAtendimento"("idPR7");

-- CreateIndex
CREATE INDEX "PagamentoAtendimento_atendimentoId_idx" ON "PagamentoAtendimento"("atendimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "PagamentoAtendimento_pagamentoId_idPR7_key" ON "PagamentoAtendimento"("pagamentoId", "idPR7");

-- CreateIndex
CREATE INDEX "Atendimento_pagoEm_idx" ON "Atendimento"("pagoEm");

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoAtendimento" ADD CONSTRAINT "PagamentoAtendimento_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "Pagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoAtendimento" ADD CONSTRAINT "PagamentoAtendimento_atendimentoId_fkey" FOREIGN KEY ("atendimentoId") REFERENCES "Atendimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

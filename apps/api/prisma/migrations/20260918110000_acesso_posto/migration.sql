-- Acesso físico ao posto (chave/senha de cadeado), preenchido conforme atendimentos
CREATE TABLE "AcessoPosto" (
    "id" TEXT NOT NULL,
    "contaId" TEXT,
    "posto" TEXT NOT NULL,
    "cidade" TEXT, "uf" TEXT, "cliente" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'DESCONHECIDO',
    "segredo" TEXT,
    "observacao" TEXT,
    "historico" JSONB NOT NULL DEFAULT '[]',
    "atualizadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcessoPosto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AcessoPosto_contaId_key" ON "AcessoPosto"("contaId");
CREATE INDEX "AcessoPosto_posto_idx" ON "AcessoPosto"("posto");
ALTER TABLE "AcessoPosto" ADD CONSTRAINT "AcessoPosto_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

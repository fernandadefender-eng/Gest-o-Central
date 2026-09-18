-- CreateTable
CREATE TABLE "Restrito" (
    "id" TEXT NOT NULL,
    "nomeCompleto" TEXT NOT NULL,
    "nomeBusca" TEXT NOT NULL,
    "telefone" TEXT,
    "regiao" TEXT,
    "motivo" TEXT,
    "origem" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPor" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Restrito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Restrito_telefone_key" ON "Restrito"("telefone");

-- CreateIndex
CREATE INDEX "Restrito_nomeBusca_idx" ON "Restrito"("nomeBusca");

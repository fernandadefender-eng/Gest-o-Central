-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "apelido" TEXT;

-- AlterTable
ALTER TABLE "ProviderMembro" ADD COLUMN     "apelido" TEXT,
ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "nomeCompleto" TEXT,
ADD COLUMN     "telefone" TEXT;

-- CreateTable
CREATE TABLE "EventoSeguranca" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "ip" TEXT,
    "usuario" TEXT,
    "detalhe" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoSeguranca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventoSeguranca_tipo_criadoEm_idx" ON "EventoSeguranca"("tipo", "criadoEm");

-- CreateIndex
CREATE INDEX "EventoSeguranca_criadoEm_idx" ON "EventoSeguranca"("criadoEm");

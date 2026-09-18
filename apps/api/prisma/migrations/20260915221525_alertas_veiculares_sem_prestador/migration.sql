-- AlterEnum
ALTER TYPE "EventoDesfecho" ADD VALUE 'SEM_PRESTADOR';

-- CreateTable
CREATE TABLE "AlertaVeicular" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "chassi" TEXT,
    "descricao" TEXT,
    "cor" TEXT,
    "anoModelo" TEXT,
    "localOcorrencia" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "dataHoraTexto" TEXT,
    "divulgadoEm" TIMESTAMP(3) NOT NULL,
    "grupo" TEXT,
    "remetente" TEXT,
    "empresaId" TEXT,
    "messageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "textoOriginal" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertaVeicular_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertaVeicular_messageId_key" ON "AlertaVeicular"("messageId");

-- CreateIndex
CREATE INDEX "AlertaVeicular_placa_idx" ON "AlertaVeicular"("placa");

-- CreateIndex
CREATE INDEX "AlertaVeicular_divulgadoEm_idx" ON "AlertaVeicular"("divulgadoEm");

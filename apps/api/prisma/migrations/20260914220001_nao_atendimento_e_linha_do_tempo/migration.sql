-- CreateEnum
CREATE TYPE "MotivoNaoAtendimento" AS ENUM ('CANCELADO_CLIENTE', 'NEGATIVA_PRESTADOR', 'DEMORA_ATENDIMENTO', 'SEM_PRESTADOR_REGIAO', 'FALSO_ALARME', 'DUPLICADO', 'OUTRO');

-- AlterEnum
ALTER TYPE "AtendimentoStatus" ADD VALUE 'NAO_ATENDIDO';

-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN     "acionadoEm" TIMESTAMP(3),
ADD COLUMN     "chegadaEm" TIMESTAMP(3),
ADD COLUMN     "concluidoEm" TIMESTAMP(3),
ADD COLUMN     "detalheNaoAtendimento" TEXT,
ADD COLUMN     "encerradoEm" TIMESTAMP(3),
ADD COLUMN     "encerradoPor" TEXT,
ADD COLUMN     "motivoNaoAtendimento" "MotivoNaoAtendimento",
ADD COLUMN     "recusadoPorId" TEXT,
ADD COLUMN     "solicitadoEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Atendimento_operadorPR7_createdAt_idx" ON "Atendimento"("operadorPR7", "createdAt");

-- CreateIndex
CREATE INDEX "Atendimento_motivoNaoAtendimento_idx" ON "Atendimento"("motivoNaoAtendimento");

-- AddForeignKey
ALTER TABLE "Atendimento" ADD CONSTRAINT "Atendimento_recusadoPorId_fkey" FOREIGN KEY ("recusadoPorId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

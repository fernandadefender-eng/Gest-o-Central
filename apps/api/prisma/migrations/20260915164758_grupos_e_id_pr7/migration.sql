-- CreateEnum
CREATE TYPE "GrupoTipo" AS ENUM ('CLIENTE', 'PRESTADOR', 'INTERNO');

-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN     "idPR7" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "tipoGrupo" "GrupoTipo";

-- AlterTable
ALTER TABLE "Evento" ADD COLUMN     "idPR7" TEXT;

-- CreateIndex
CREATE INDEX "Atendimento_idPR7_idx" ON "Atendimento"("idPR7");

-- CreateEnum
CREATE TYPE "SacTipo" AS ENUM ('PAGAMENTO_ATRASO', 'ATENDIMENTO_ATRASO', 'RECLAMACAO', 'DUVIDA', 'OUTRO');

-- CreateEnum
CREATE TYPE "SacStatus" AS ENUM ('ABERTO', 'EM_TRATATIVA', 'AGUARDANDO_FINANCEIRO', 'RESOLVIDO');

-- CreateTable
CREATE TABLE "ChamadoSac" (
    "id" TEXT NOT NULL,
    "tipo" "SacTipo" NOT NULL,
    "status" "SacStatus" NOT NULL DEFAULT 'ABERTO',
    "prioridade" "EventoPrioridade" NOT NULL DEFAULT 'MEDIA',
    "assunto" TEXT NOT NULL,
    "descricao" TEXT,
    "solicitante" TEXT,
    "telefone" TEXT,
    "regiao" TEXT,
    "providerId" TEXT,
    "idsCitados" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "grupo" TEXT,
    "remetente" TEXT,
    "messageId" TEXT,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "resolvidoEm" TIMESTAMP(3),
    "resolvidoPor" TEXT,
    "solucao" TEXT,

    CONSTRAINT "ChamadoSac_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SacTratativa" (
    "id" TEXT NOT NULL,
    "sacId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SacTratativa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChamadoSac_messageId_key" ON "ChamadoSac"("messageId");

-- CreateIndex
CREATE INDEX "ChamadoSac_status_prioridade_idx" ON "ChamadoSac"("status", "prioridade");

-- CreateIndex
CREATE INDEX "ChamadoSac_abertoEm_idx" ON "ChamadoSac"("abertoEm");

-- CreateIndex
CREATE INDEX "ChamadoSac_providerId_idx" ON "ChamadoSac"("providerId");

-- CreateIndex
CREATE INDEX "SacTratativa_sacId_criadoEm_idx" ON "SacTratativa"("sacId", "criadoEm");

-- AddForeignKey
ALTER TABLE "SacTratativa" ADD CONSTRAINT "SacTratativa_sacId_fkey" FOREIGN KEY ("sacId") REFERENCES "ChamadoSac"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "EventoStatus" AS ENUM ('NOVO', 'EM_TRATATIVA', 'AGUARDANDO', 'ENCAMINHADO', 'ENCERRADO');

-- CreateEnum
CREATE TYPE "EventoPrioridade" AS ENUM ('CRITICA', 'ALTA', 'MEDIA', 'BAIXA');

-- CreateEnum
CREATE TYPE "EventoDesfecho" AS ENUM ('ATENDIMENTO_REALIZADO', 'FALSO_ALARME', 'RESOLVIDO_REMOTO', 'SEM_CONTATO', 'CANCELADO_CLIENTE', 'DUPLICADO');

-- CreateTable
CREATE TABLE "Evento" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "tipo" TEXT NOT NULL,
    "prioridade" "EventoPrioridade" NOT NULL DEFAULT 'MEDIA',
    "status" "EventoStatus" NOT NULL DEFAULT 'NOVO',
    "descricao" TEXT,
    "clienteNome" TEXT,
    "placa" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "ocorrencia" TEXT,
    "ocorridoEm" TIMESTAMP(3),
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assumidoPor" TEXT,
    "assumidoEm" TIMESTAMP(3),
    "encerradoPor" TEXT,
    "encerradoEm" TIMESTAMP(3),
    "desfecho" "EventoDesfecho",
    "atendimentoId" TEXT,

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoTratativa" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoTratativa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Evento_atendimentoId_key" ON "Evento"("atendimentoId");

-- CreateIndex
CREATE INDEX "Evento_status_prioridade_recebidoEm_idx" ON "Evento"("status", "prioridade", "recebidoEm");

-- CreateIndex
CREATE INDEX "EventoTratativa_eventoId_criadoEm_idx" ON "EventoTratativa"("eventoId", "criadoEm");

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_atendimentoId_fkey" FOREIGN KEY ("atendimentoId") REFERENCES "Atendimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoTratativa" ADD CONSTRAINT "EventoTratativa_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "Evento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

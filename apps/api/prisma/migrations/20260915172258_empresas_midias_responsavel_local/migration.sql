-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN     "empresaId" TEXT,
ADD COLUMN     "responsavelLocalNome" TEXT,
ADD COLUMN     "responsavelLocalTelefone" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "empresaId" TEXT;

-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "cnpj" TEXT,
    "inscMunicipal" TEXT,
    "inscEstadual" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "endereco" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "cep" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "situacao" TEXT,
    "qtdOrdensServico" INTEGER,
    "cadastradoEm" TIMESTAMP(3),
    "apelidos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Midia" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "mimeType" TEXT,
    "legenda" TEXT,
    "nomeOriginal" TEXT,
    "arquivo" TEXT,
    "tamanhoBytes" INTEGER,
    "sha256" TEXT,
    "urlOrigem" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "erro" TEXT,
    "messageId" TEXT,
    "conversationId" TEXT,
    "atendimentoId" TEXT,
    "noRelatorio" BOOLEAN NOT NULL DEFAULT true,
    "recebidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Midia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_cnpj_key" ON "Empresa"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Midia_messageId_key" ON "Midia"("messageId");

-- CreateIndex
CREATE INDEX "Midia_atendimentoId_idx" ON "Midia"("atendimentoId");

-- CreateIndex
CREATE INDEX "Midia_conversationId_recebidaEm_idx" ON "Midia"("conversationId", "recebidaEm");

-- AddForeignKey
ALTER TABLE "Midia" ADD CONSTRAINT "Midia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Midia" ADD CONSTRAINT "Midia_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Midia" ADD CONSTRAINT "Midia_atendimentoId_fkey" FOREIGN KEY ("atendimentoId") REFERENCES "Atendimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atendimento" ADD CONSTRAINT "Atendimento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN     "contaId" TEXT,
ADD COLUMN     "ocorrencia" TEXT,
ADD COLUMN     "operadorPR7" TEXT;

-- CreateTable
CREATE TABLE "Conta" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "estabelecimento" TEXT NOT NULL,
    "endereco" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "enderecoTravado" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conta_codigo_key" ON "Conta"("codigo");

-- CreateIndex
CREATE INDEX "Conta_clientId_idx" ON "Conta"("clientId");

-- CreateIndex
CREATE INDEX "Atendimento_contaId_idx" ON "Atendimento"("contaId");

-- AddForeignKey
ALTER TABLE "Conta" ADD CONSTRAINT "Conta_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atendimento" ADD CONSTRAINT "Atendimento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ProviderTipo" AS ENUM ('INDIVIDUAL', 'EQUIPE');

-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN     "agenteNome" TEXT;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "cidadeBase" TEXT,
ADD COLUMN     "estadoBase" TEXT,
ADD COLUMN     "origem" TEXT,
ADD COLUMN     "pendencias" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tipo" "ProviderTipo" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "ultimoAtendimento" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProviderMembro" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "atendimentos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProviderMembro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderArea" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "atendimentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoAtendimento" TIMESTAMP(3),

    CONSTRAINT "ProviderArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cidade" (
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "encontrada" BOOLEAN NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cidade_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderMembro_providerId_nome_key" ON "ProviderMembro"("providerId", "nome");

-- CreateIndex
CREATE INDEX "ProviderArea_estado_idx" ON "ProviderArea"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderArea_providerId_cidade_estado_key" ON "ProviderArea"("providerId", "cidade", "estado");

-- AddForeignKey
ALTER TABLE "ProviderMembro" ADD CONSTRAINT "ProviderMembro_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderArea" ADD CONSTRAINT "ProviderArea_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('PATRIMONIAL', 'VEICULAR');

-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN     "detalhes" JSONB,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "placa" TEXT,
ADD COLUMN     "vertical" "Vertical" NOT NULL DEFAULT 'PATRIMONIAL';

-- CreateIndex
CREATE INDEX "Atendimento_vertical_createdAt_idx" ON "Atendimento"("vertical", "createdAt");

-- CreateIndex
CREATE INDEX "Atendimento_placa_idx" ON "Atendimento"("placa");

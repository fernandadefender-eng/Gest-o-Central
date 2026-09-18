-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN     "idInterno" TEXT;

-- AlterTable
ALTER TABLE "Evento" ADD COLUMN     "idInterno" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Atendimento_idInterno_key" ON "Atendimento"("idInterno");

-- CreateIndex
CREATE UNIQUE INDEX "Evento_idInterno_key" ON "Evento"("idInterno");


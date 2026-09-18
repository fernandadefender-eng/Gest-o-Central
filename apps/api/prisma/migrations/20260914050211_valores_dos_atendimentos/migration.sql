-- AlterTable
ALTER TABLE "Atendimento" ADD COLUMN     "formaPagamento" TEXT,
ADD COLUMN     "valorCliente" DECIMAL(12,2),
ADD COLUMN     "valorPrestador" DECIMAL(12,2),
ADD COLUMN     "valorTotalPrestador" DECIMAL(12,2);

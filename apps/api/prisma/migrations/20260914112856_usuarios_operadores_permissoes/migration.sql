-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ADMIN', 'OPERADOR');

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "criadoPor" TEXT,
ADD COLUMN     "nome" TEXT NOT NULL DEFAULT 'Administrador',
ADD COLUMN     "papel" "Papel" NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "permissoes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "senhaAlteradaEm" TIMESTAMP(3),
ADD COLUMN     "ultimoAcesso" TIMESTAMP(3),
ADD COLUMN     "verticais" "Vertical"[] DEFAULT ARRAY['PATRIMONIAL', 'VEICULAR']::"Vertical"[];

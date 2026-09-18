-- AlterEnum
ALTER TYPE "ProviderStatus" ADD VALUE 'RESTRITO';

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "motivoRestricao" TEXT,
ADD COLUMN     "restritoEm" TIMESTAMP(3),
ADD COLUMN     "restritoPor" TEXT;

-- AlterTable
ALTER TABLE "ProviderMembro" ADD COLUMN     "motivoRestricao" TEXT,
ADD COLUMN     "restrito" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restritoEm" TIMESTAMP(3),
ADD COLUMN     "restritoPor" TEXT;

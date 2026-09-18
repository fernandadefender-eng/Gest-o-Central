-- DropForeignKey
ALTER TABLE "Atendimento" DROP CONSTRAINT "Atendimento_conversationId_fkey";

-- AlterTable
ALTER TABLE "Atendimento" ALTER COLUMN "conversationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Atendimento" ADD CONSTRAINT "Atendimento_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

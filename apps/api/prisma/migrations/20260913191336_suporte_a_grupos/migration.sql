-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "senderName" TEXT,
ADD COLUMN     "senderPhone" TEXT;

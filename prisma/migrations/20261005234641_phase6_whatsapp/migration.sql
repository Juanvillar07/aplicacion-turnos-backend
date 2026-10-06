-- CreateEnum
CREATE TYPE "WhatsappDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "WhatsappStatus" AS ENUM ('RECEIVED', 'SENT', 'FAILED', 'PREVIEW');

-- AlterEnum
ALTER TYPE "AppointmentSource" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp_opt_in_at" TIMESTAMP(3),
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "phone" TEXT NOT NULL,
    "business_id" TEXT,
    "state" JSONB NOT NULL DEFAULT '{}',
    "last_inbound_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "direction" "WhatsappDirection" NOT NULL,
    "phone" TEXT NOT NULL,
    "business_id" TEXT,
    "kind" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" "WhatsappStatus" NOT NULL,
    "error" TEXT,
    "wa_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_messages_phone_created_at_idx" ON "whatsapp_messages"("phone", "created_at");

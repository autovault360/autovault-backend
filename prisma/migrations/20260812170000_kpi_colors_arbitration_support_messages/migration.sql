-- AlterEnum
ALTER TYPE "VehicleStatus" ADD VALUE IF NOT EXISTS 'arbitration';

-- AlterTable
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "kpiColors" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dealershipId" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "support_messages_dealershipId_idx" ON "support_messages"("dealershipId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "support_messages_status_idx" ON "support_messages"("status");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_messages_dealershipId_fkey'
  ) THEN
    ALTER TABLE "support_messages"
      ADD CONSTRAINT "support_messages_dealershipId_fkey"
      FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_messages_userId_fkey'
  ) THEN
    ALTER TABLE "support_messages"
      ADD CONSTRAINT "support_messages_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

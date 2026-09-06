-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "auctionHouse" TEXT;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "auctionDate" DATE;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "auctionRuns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "saleChannel" TEXT;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "titlePresent" BOOLEAN NOT NULL DEFAULT true;

-- Backfill titlePresent from titleReceived where useful
UPDATE "vehicles" SET "titlePresent" = "titleReceived" WHERE "titleReceived" IS NOT NULL;

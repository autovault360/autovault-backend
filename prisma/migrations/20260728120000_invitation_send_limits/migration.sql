-- Track invite email sends: max 3 while pending, with cooldown between sends
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "sendCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3);

UPDATE "invitations"
SET "lastSentAt" = COALESCE("lastSentAt", "createdAt")
WHERE "lastSentAt" IS NULL;

ALTER TABLE "invitations" ALTER COLUMN "lastSentAt" SET NOT NULL;
ALTER TABLE "invitations" ALTER COLUMN "lastSentAt" SET DEFAULT CURRENT_TIMESTAMP;

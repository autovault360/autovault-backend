-- User onboarding / legal agreement fields (were in schema but missing a migration)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "introCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsAccepted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsPrintedName" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsDealership" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsSignature" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsIp" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsUserAgent" TEXT;

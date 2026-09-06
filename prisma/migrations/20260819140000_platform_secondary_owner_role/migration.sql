-- Avoid ALTER TYPE "UserRole" (requires type ownership).
-- Secondary owners stay role = platform_owner; main owner is flagged here.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isMainPlatformOwner" BOOLEAN NOT NULL DEFAULT false;

-- Add username field to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255);
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username");

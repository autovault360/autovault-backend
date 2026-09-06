-- Track when the first-login welcome email was sent for a user
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "welcomeEmailSentAt" TIMESTAMP(3);

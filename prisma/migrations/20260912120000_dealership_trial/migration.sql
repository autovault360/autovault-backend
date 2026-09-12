-- App-managed 25-day no-card trial clock and reminder markers.
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "trialEmail7For" TIMESTAMP(3);
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "trialEmail3For" TIMESTAMP(3);
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "trialEndedEmailFor" TIMESTAMP(3);

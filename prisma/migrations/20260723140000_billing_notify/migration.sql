-- AlterTable
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "billingNotifyBefore" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "billingReminderFor" TIMESTAMP(3);
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "billingDueEmailFor" TIMESTAMP(3);

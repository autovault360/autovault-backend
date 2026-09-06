-- AlterTable
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "billingAutoExpense" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "cardBrand" TEXT;
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "cardLast4" VARCHAR(4);
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "cardExpMonth" INTEGER;
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "cardExpYear" INTEGER;
ALTER TABLE "dealerships" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "dealerships_stripeCustomerId_idx" ON "dealerships"("stripeCustomerId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "billing_payments" (
    "id" UUID NOT NULL,
    "dealershipId" UUID NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'usd',
    "status" VARCHAR(20) NOT NULL,
    "planSlug" VARCHAR(40),
    "planLabel" VARCHAR(80),
    "paidAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "hostedInvoiceUrl" TEXT,
    "expenseId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_payments_stripeInvoiceId_key" ON "billing_payments"("stripeInvoiceId");
CREATE INDEX IF NOT EXISTS "billing_payments_dealershipId_paidAt_idx" ON "billing_payments"("dealershipId", "paidAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_payments_dealershipId_fkey'
  ) THEN
    ALTER TABLE "billing_payments"
      ADD CONSTRAINT "billing_payments_dealershipId_fkey"
      FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

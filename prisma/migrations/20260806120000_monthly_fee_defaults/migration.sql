-- Align default monthly fee with post-trial plan pricing ($99.99 base).
ALTER TABLE "registrations" ALTER COLUMN "monthlyFee" SET DEFAULT 99.99;
ALTER TABLE "dealerships" ALTER COLUMN "monthlyFee" SET DEFAULT 99.99;

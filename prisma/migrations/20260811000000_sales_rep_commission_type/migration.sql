-- Sales rep commission: percentage vs flat dollar rate
DO $$ BEGIN
  CREATE TYPE "SalesRepCommissionType" AS ENUM ('percentage', 'flat');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "sales_rep_profiles"
  ADD COLUMN IF NOT EXISTS "commissionType" "SalesRepCommissionType" NOT NULL DEFAULT 'percentage';

ALTER TABLE "sales_rep_profiles"
  ALTER COLUMN "commissionRate" TYPE DECIMAL(12, 4);

ALTER TABLE "sales_rep_commissions"
  ALTER COLUMN "commissionRate" TYPE DECIMAL(12, 4);

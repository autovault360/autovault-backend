-- AlterTable: Remove unused columns, add new ones, add payment fields
ALTER TABLE "sales_rep_profiles" DROP COLUMN IF EXISTS "address",
DROP COLUMN IF EXISTS "city",
DROP COLUMN IF EXISTS "state",
DROP COLUMN IF EXISTS "zip",
DROP COLUMN IF EXISTS "hireDate",
DROP COLUMN IF EXISTS "monthlyGoal";

ALTER TABLE "sales_rep_profiles" ADD COLUMN IF NOT EXISTS "birthDate" DATE,
ADD COLUMN IF NOT EXISTS "baseSalary" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "payFrequency" VARCHAR(20),
ADD COLUMN IF NOT EXISTS "payDay" INTEGER,
ADD COLUMN IF NOT EXISTS "paymentMethod" VARCHAR(20),
ADD COLUMN IF NOT EXISTS "payDocUrl" TEXT;

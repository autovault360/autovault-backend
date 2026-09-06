-- AlterTable
ALTER TABLE "dealership_tax_settings" ADD COLUMN IF NOT EXISTS "nextDueDate" DATE;
ALTER TABLE "dealership_tax_settings" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- AlterTable (Prisma @@map("flooring_plans"))
ALTER TABLE "flooring_plans" ADD COLUMN IF NOT EXISTS "configJson" JSONB;

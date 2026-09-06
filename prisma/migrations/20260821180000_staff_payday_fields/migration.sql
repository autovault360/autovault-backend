-- Staff payday / schedule fields so payroll reminders, calendar, and history persist.
ALTER TABLE "staff_members"
  ADD COLUMN IF NOT EXISTS "payFrequency" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "payDay" INTEGER,
  ADD COLUMN IF NOT EXISTS "payAnchor" DATE,
  ADD COLUMN IF NOT EXISTS "workDays" JSONB,
  ADD COLUMN IF NOT EXISTS "hoursPerDay" DECIMAL(6, 2);

-- Biweekly anchor for sales reps (same rule as staff).
ALTER TABLE "sales_rep_profiles"
  ADD COLUMN IF NOT EXISTS "payAnchor" DATE;

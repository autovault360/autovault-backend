-- Add flat to deal CommissionType enum
-- (separate migration: some PG versions restrict ADD VALUE with other ops)
DO $$ BEGIN
  ALTER TYPE "CommissionType" ADD VALUE 'flat';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN
    -- already exists
    NULL;
END $$;

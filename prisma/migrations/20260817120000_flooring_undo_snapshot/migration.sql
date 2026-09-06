-- CreateTable
CREATE TABLE IF NOT EXISTS "flooring_undo_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dealershipId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flooring_undo_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "flooring_undo_snapshots_dealershipId_key"
  ON "flooring_undo_snapshots"("dealershipId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "flooring_undo_snapshots_expiresAt_idx"
  ON "flooring_undo_snapshots"("expiresAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'flooring_undo_snapshots_dealershipId_fkey'
  ) THEN
    ALTER TABLE "flooring_undo_snapshots"
      ADD CONSTRAINT "flooring_undo_snapshots_dealershipId_fkey"
      FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

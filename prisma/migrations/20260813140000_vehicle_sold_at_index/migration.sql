-- Period-aware vehicle KPI queries filter sold history by dealership + soldAt.
CREATE INDEX IF NOT EXISTS "vehicles_dealershipId_soldAt_idx" ON "vehicles"("dealershipId", "soldAt");

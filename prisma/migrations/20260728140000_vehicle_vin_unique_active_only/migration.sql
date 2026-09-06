-- Allow VIN reuse after soft-delete: unique only among active (non-deleted) vehicles.
DROP INDEX IF EXISTS "vehicles_dealershipId_vin_key";

CREATE UNIQUE INDEX "vehicles_dealershipId_vin_active_key"
ON "vehicles"("dealershipId", "vin")
WHERE "deletedAt" IS NULL;

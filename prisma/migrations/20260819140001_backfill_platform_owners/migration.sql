-- Keep owner@autovault360.com as the main platform owner.
-- Other active platform_owner accounts are secondary owners.
UPDATE "users"
SET "isMainPlatformOwner" = true
WHERE "role" = 'platform_owner'
  AND "deletedAt" IS NULL
  AND lower("email") = 'owner@autovault360.com';

UPDATE "users"
SET "isMainPlatformOwner" = false
WHERE "role" = 'platform_owner'
  AND "deletedAt" IS NULL
  AND lower("email") <> 'owner@autovault360.com';

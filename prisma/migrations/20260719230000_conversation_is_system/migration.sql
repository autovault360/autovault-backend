-- Default sales-rep group chat (system conversations cannot be left/renamed)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "conversations_dealershipId_isSystem_idx"
  ON "conversations"("dealershipId", "isSystem");

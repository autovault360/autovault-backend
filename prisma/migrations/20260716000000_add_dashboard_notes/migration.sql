-- CreateTable
CREATE TABLE "dashboard_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dealershipId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_notes_dealershipId_idx" ON "dashboard_notes"("dealershipId");

-- AddForeignKey
ALTER TABLE "dashboard_notes" ADD CONSTRAINT "dashboard_notes_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "dealerships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

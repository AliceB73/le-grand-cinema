-- AlterTable
ALTER TABLE "Room"
  ADD COLUMN "rows" INTEGER,
  ADD COLUMN "columns" INTEGER,
  ADD COLUMN "defaultPrice" DOUBLE PRECISION NOT NULL DEFAULT 9.5;

UPDATE "Room"
SET "columns" = CASE "category"
    WHEN 'PREMIUM_IMAX' THEN 20
    WHEN 'STANDARD' THEN 15
    WHEN 'VIP' THEN 12
    ELSE 10
  END;
UPDATE "Room" SET "rows" = CEIL("capacity"::numeric / "columns")::INTEGER;

ALTER TABLE "Room"
  ALTER COLUMN "rows" SET NOT NULL,
  ALTER COLUMN "columns" SET NOT NULL;

-- CreateTable
CREATE TABLE "SpecialRate" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialRate_roomId_startsAt_endsAt_idx" ON "SpecialRate"("roomId", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "SpecialRate" ADD CONSTRAINT "SpecialRate_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("name") ON DELETE CASCADE ON UPDATE CASCADE;

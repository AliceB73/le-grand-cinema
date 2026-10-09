-- CreateEnum
CREATE TYPE "RoomCategory" AS ENUM ('PREMIUM_IMAX', 'STANDARD', 'VIP', 'EVENT');

-- CreateTable
CREATE TABLE "Room" (
    "name" TEXT NOT NULL,
    "category" "RoomCategory" NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("name")
);

-- Insert validated cinema rooms and capacities
INSERT INTO "Room" ("name", "category", "capacity") VALUES
    ('Salle A', 'PREMIUM_IMAX', 300),
    ('Salle B', 'PREMIUM_IMAX', 300),
    ('Salle C', 'STANDARD', 180),
    ('Salle D', 'STANDARD', 180),
    ('Salle E', 'STANDARD', 180),
    ('Salle F', 'STANDARD', 180),
    ('Salle G', 'VIP', 120),
    ('Salle H', 'VIP', 120),
    ('Salle I', 'EVENT', 70),
    ('Salle J', 'EVENT', 70);

-- Add roomId to Showtime
ALTER TABLE "Showtime" ADD COLUMN "roomId" TEXT;

-- Existing room names are migrated to the approved A-J mapping.
UPDATE "Showtime" SET "roomId" = "roomName";

-- AlterTable
ALTER TABLE "Showtime" ALTER COLUMN "roomId" SET NOT NULL;
ALTER TABLE "Showtime" DROP COLUMN "roomName";

-- AddForeignKey
ALTER TABLE "Showtime" ADD CONSTRAINT "Showtime_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

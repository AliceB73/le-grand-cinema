CREATE TABLE "SeatHold" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatHold_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Seat" ADD COLUMN "holdId" TEXT;

CREATE INDEX "SeatHold_tokenHash_idx" ON "SeatHold"("tokenHash");
CREATE INDEX "SeatHold_expiresAt_idx" ON "SeatHold"("expiresAt");

ALTER TABLE "Seat" ADD CONSTRAINT "Seat_holdId_fkey"
    FOREIGN KEY ("holdId") REFERENCES "SeatHold"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

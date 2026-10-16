CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

ALTER TABLE "Booking"
  ADD COLUMN "ticketTokenHash" TEXT,
  ADD COLUMN "checkedInAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Booking_ticketTokenHash_key"
  ON "Booking"("ticketTokenHash");

CREATE TABLE "EmailDelivery" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDelivery_bookingId_key"
  ON "EmailDelivery"("bookingId");
CREATE INDEX "EmailDelivery_status_nextAttemptAt_idx"
  ON "EmailDelivery"("status", "nextAttemptAt");
CREATE INDEX "EmailDelivery_status_lockedUntil_idx"
  ON "EmailDelivery"("status", "lockedUntil");

ALTER TABLE "EmailDelivery"
  ADD CONSTRAINT "EmailDelivery_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

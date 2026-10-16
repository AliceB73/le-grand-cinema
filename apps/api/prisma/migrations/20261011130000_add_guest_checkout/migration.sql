ALTER TYPE "BookingStatus" ADD VALUE 'REFUND_REQUIRED';

ALTER TABLE "Booking"
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "guestEmail" TEXT,
  ADD COLUMN "stripeCheckoutSessionId" TEXT,
  ADD COLUMN "seatHoldTokenHash" TEXT,
  ADD COLUMN "seatIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "totalAmountCents" INTEGER;

CREATE UNIQUE INDEX "Booking_stripeCheckoutSessionId_key"
  ON "Booking"("stripeCheckoutSessionId");

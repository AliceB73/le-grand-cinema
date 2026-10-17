CREATE TYPE "ShowtimeStatus" AS ENUM ('SCHEDULED', 'CANCELLED');
CREATE TYPE "EmailDeliveryKind" AS ENUM ('TICKET', 'SHOWTIME_CANCELLED');

ALTER TABLE "Showtime"
  ADD COLUMN "status" "ShowtimeStatus" NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "EmailDelivery"
  ADD COLUMN "kind" "EmailDeliveryKind" NOT NULL DEFAULT 'TICKET';

DROP INDEX "EmailDelivery_bookingId_key";
CREATE UNIQUE INDEX "EmailDelivery_bookingId_kind_key"
  ON "EmailDelivery"("bookingId", "kind");

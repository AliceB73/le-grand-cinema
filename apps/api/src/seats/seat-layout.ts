import type { RoomCategory } from '@prisma/client';

const seatsPerRowByCategory: Record<RoomCategory, number> = {
  PREMIUM_IMAX: 20,
  STANDARD: 15,
  VIP: 12,
  EVENT: 10,
};

export function buildSeatLayout(
  showtimeId: string,
  capacity: number,
  category: RoomCategory,
) {
  const seatsPerRow = seatsPerRowByCategory[category];
  return Array.from({ length: capacity }, (_, index) => ({
    showtimeId,
    rowNumber: String.fromCharCode(
      'A'.charCodeAt(0) + Math.floor(index / seatsPerRow),
    ),
    seatNumber: (index % seatsPerRow) + 1,
  }));
}

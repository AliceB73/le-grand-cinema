export const MAX_ROOM_ROWS = 26;
export const MAX_ROOM_COLUMNS = 40;

export function buildSeatLayout(
  showtimeId: string,
  rows: number,
  columns: number,
) {
  return Array.from({ length: rows * columns }, (_, index) => ({
    showtimeId,
    rowNumber: String.fromCharCode(
      'A'.charCodeAt(0) + Math.floor(index / columns),
    ),
    seatNumber: (index % columns) + 1,
  }));
}

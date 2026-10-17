import { describe, expect, it } from '@jest/globals';
import { buildSeatLayout } from './seat-layout.js';

describe('buildSeatLayout', () => {
  it('fills rows according to the room category', () => {
    const seats = buildSeatLayout('s1', 70, 'EVENT');
    expect(seats).toHaveLength(70);
    expect(seats[0]).toEqual({
      showtimeId: 's1',
      rowNumber: 'A',
      seatNumber: 1,
    });
    expect(seats[10]).toMatchObject({ rowNumber: 'B', seatNumber: 1 });
    expect(seats[69]).toMatchObject({ rowNumber: 'G', seatNumber: 10 });
  });
});

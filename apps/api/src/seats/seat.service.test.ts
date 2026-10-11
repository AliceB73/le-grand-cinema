import { describe, expect, it, jest } from '@jest/globals';
import {
  createTemporarySeatHold,
  getSeatMap,
  SEAT_HOLD_DURATION_MS,
  SeatUnavailableError,
  type SeatRepository,
} from './seat.service.js';

const now = new Date('2026-10-11T10:00:00.000Z');
const sessionToken = '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b';

type SeatFixture = {
  id: string;
  rowNumber: string;
  seatNumber: number;
  bookingId: string | null;
  holdTokenHash: string | null;
  holdExpiresAt: Date | null;
};

function createRepository(
  seats: SeatFixture[] = [
    {
      id: 'seat-free',
      rowNumber: 'A',
      seatNumber: 1,
      bookingId: null,
      holdTokenHash: null,
      holdExpiresAt: null,
    },
    {
      id: 'seat-booked',
      rowNumber: 'A',
      seatNumber: 2,
      bookingId: 'booking-1',
      holdTokenHash: null,
      holdExpiresAt: null,
    },
    {
      id: 'seat-held',
      rowNumber: 'A',
      seatNumber: 3,
      bookingId: null,
      holdTokenHash:
        'c0620acca9d2a3ed0a2383694af18c9d057faa89191268bf9082ca15b98ba421',
      holdExpiresAt: new Date('2026-10-11T10:10:00.000Z'),
    },
  ],
): jest.Mocked<SeatRepository> {
  return {
    findShowtimeSeats: jest
      .fn<SeatRepository['findShowtimeSeats']>()
      .mockResolvedValue({
        exists: true,
        seats,
      }),
    createTemporaryHold: jest
      .fn<SeatRepository['createTemporaryHold']>()
      .mockResolvedValue(),
  };
}

describe('seat service', () => {
  it('returns free, occupied, held, and expired states without exposing session tokens', async () => {
    const baseRepository = createRepository();
    const { seats } = await baseRepository.findShowtimeSeats('showtime-1');
    const repository = createRepository([
      ...seats.map((seat) =>
        seat.id === 'seat-held'
          ? { ...seat, holdTokenHash: 'another-session-hash' }
          : seat,
      ),
      {
        id: 'seat-expired',
        rowNumber: 'B',
        seatNumber: 1,
        bookingId: null,
        holdTokenHash: 'expired-token',
        holdExpiresAt: new Date('2026-10-11T09:59:59.000Z'),
      },
    ]);

    const result = await getSeatMap(
      'showtime-1',
      sessionToken,
      repository,
      now,
    );

    expect(result?.seats.map(({ id, status }) => [id, status])).toEqual([
      ['seat-free', 'available'],
      ['seat-booked', 'occupied'],
      ['seat-held', 'held'],
      ['seat-expired', 'available'],
    ]);
    expect(result?.seats[2]).toMatchObject({
      heldByCurrentSession: false,
      expiresAt: '2026-10-11T10:10:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain(sessionToken);
  });

  it('marks a hold as owned by the matching anonymous session', async () => {
    const repository = createRepository([
      {
        id: 'seat-held',
        rowNumber: 'A',
        seatNumber: 1,
        bookingId: null,
        holdTokenHash:
          'c0620acca9d2a3ed0a2383694af18c9d057faa89191268bf9082ca15b98ba421',
        holdExpiresAt: new Date('2026-10-11T10:10:00.000Z'),
      },
    ]);

    const result = await getSeatMap(
      'showtime-1',
      sessionToken,
      repository,
      now,
    );

    expect(result?.seats[0]?.heldByCurrentSession).toBe(true);
  });

  it('creates an atomic ten-minute hold for available seats', async () => {
    const repository = createRepository();

    const result = await createTemporarySeatHold(
      'showtime-1',
      ['seat-free'],
      sessionToken,
      repository,
      now,
    );

    expect(result).toEqual({
      heldSeatIds: ['seat-free'],
      expiresAt: '2026-10-11T10:10:00.000Z',
    });
    expect(repository.createTemporaryHold).toHaveBeenCalledWith(
      'showtime-1',
      ['seat-free'],
      'c0620acca9d2a3ed0a2383694af18c9d057faa89191268bf9082ca15b98ba421',
      new Date(now.getTime() + SEAT_HOLD_DURATION_MS),
      now,
    );
  });

  it('rejects occupied and temporarily held seats before persisting a hold', async () => {
    const repository = createRepository();

    await expect(
      createTemporarySeatHold(
        'showtime-1',
        ['seat-booked', 'seat-held'],
        sessionToken,
        repository,
        now,
      ),
    ).rejects.toEqual(new SeatUnavailableError(['seat-booked', 'seat-held']));
    expect(repository.createTemporaryHold).not.toHaveBeenCalled();
  });

  it('returns null when the screening does not exist', async () => {
    const repository = createRepository();
    repository.findShowtimeSeats.mockResolvedValue({
      exists: false,
      seats: [],
    });

    await expect(
      getSeatMap('missing-showtime', sessionToken, repository, now),
    ).resolves.toBeNull();
    await expect(
      createTemporarySeatHold(
        'missing-showtime',
        ['seat-free'],
        sessionToken,
        repository,
        now,
      ),
    ).resolves.toBeNull();
  });
});

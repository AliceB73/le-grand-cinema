import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { prisma } from '../data/prisma.js';
import { createAdminService } from './admin.service.js';
import {
  dayRangeToPeriod,
  periodToDayRange,
  periodsOverlap,
  resolveShowtimePrice,
} from './rates.js';

const now = new Date('2026-10-17T10:00:00.000Z');
const service = createAdminService(() => now);
type Fn = (...args: unknown[]) => Promise<unknown>;

function mockTransaction(tx: Record<string, unknown>) {
  jest
    .spyOn(prisma, '$transaction')
    .mockImplementation((async (callback: (client: unknown) => unknown) =>
      callback(tx)) as never);
}

describe('rates helpers', () => {
  it('converts inclusive Paris days to a half-open period and back', () => {
    const period = dayRangeToPeriod('2026-12-01', '2026-12-07')!;
    expect(period.startsAt.toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(period.endsAt.toISOString()).toBe('2026-12-07T23:00:00.000Z');
    expect(periodToDayRange(period)).toEqual({
      startDate: '2026-12-01',
      endDate: '2026-12-07',
    });
    expect(dayRangeToPeriod('2026-12-07', '2026-12-01')).toBeNull();
    expect(dayRangeToPeriod('2026-13-45', '2026-12-01')).toBeNull();
  });

  it('applies a special rate only inside its period', () => {
    const period = dayRangeToPeriod('2026-12-01', '2026-12-07')!;
    const rates = [{ ...period, price: 12 }];
    const price = (iso: string) =>
      resolveShowtimePrice(new Date(iso), 8, rates);
    expect(price('2026-12-01T18:00:00.000Z')).toBe(12);
    expect(price('2026-12-07T21:00:00.000Z')).toBe(12);
    expect(price('2026-12-07T23:00:00.000Z')).toBe(8);
    expect(price('2026-11-30T22:59:00.000Z')).toBe(8);
  });

  it('detects overlapping periods', () => {
    const a = dayRangeToPeriod('2026-12-01', '2026-12-07')!;
    const b = dayRangeToPeriod('2026-12-07', '2026-12-10')!;
    const c = dayRangeToPeriod('2026-12-08', '2026-12-10')!;
    expect(periodsOverlap(a, b)).toBe(true);
    expect(periodsOverlap(a, c)).toBe(false);
  });
});

describe('room configuration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function roomTx(bookings = 0, rows = 3, columns = 10) {
    return {
      room: {
        findUnique: jest.fn<Fn>(async () => ({
          name: 'Salle A',
          rows,
          columns,
        })),
        update: jest.fn<Fn>(async () => ({ name: 'Salle A' })),
      },
      $executeRaw: jest.fn<Fn>(async () => 1),
      showtime: {
        findMany: jest.fn<Fn>(async () => [{ id: 's1' }, { id: 's2' }]),
      },
      booking: { count: jest.fn<Fn>(async () => bookings) },
      seat: {
        deleteMany: jest.fn<Fn>(async () => ({})),
        createMany: jest.fn<Fn>(async () => ({})),
      },
    };
  }

  it('regenerates seats of upcoming showtimes when the layout changes', async () => {
    const tx = roomTx();
    mockTransaction(tx);
    await service.updateRoom('Salle A', {
      rows: 2,
      columns: 5,
      defaultPrice: 9,
    });
    expect(tx.seat.deleteMany).toHaveBeenCalled();
    const [{ data }] = tx.seat.createMany.mock.calls[0] as [
      { data: unknown[] },
    ];
    expect(data).toHaveLength(20);
    expect(tx.room.update).toHaveBeenCalledWith({
      where: { name: 'Salle A' },
      data: { rows: 2, columns: 5, capacity: 10, defaultPrice: 9 },
    });
  });

  it('refuses a layout change when upcoming showtimes have bookings', async () => {
    const tx = roomTx(2);
    mockTransaction(tx);
    await expect(
      service.updateRoom('Salle A', { rows: 2, columns: 5, defaultPrice: 9 }),
    ).rejects.toMatchObject({ reason: 'ROOM_HAS_BOOKINGS' });
    expect(tx.seat.deleteMany).not.toHaveBeenCalled();
    expect(tx.room.update).not.toHaveBeenCalled();
  });

  it('only updates the price when the layout is unchanged', async () => {
    const tx = roomTx(5);
    mockTransaction(tx);
    await service.updateRoom('Salle A', {
      rows: 3,
      columns: 10,
      defaultPrice: 11,
    });
    expect(tx.showtime.findMany).not.toHaveBeenCalled();
    expect(tx.room.update).toHaveBeenCalled();
  });

  it('fails for an unknown room', async () => {
    const tx = roomTx();
    tx.room.findUnique.mockResolvedValue(null);
    mockTransaction(tx);
    await expect(
      service.updateRoom('X', { rows: 1, columns: 1, defaultPrice: 9 }),
    ).rejects.toMatchObject({ entity: 'room' });
  });
});

describe('special rates', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const input = {
    roomName: 'Salle A',
    label: 'Festival',
    startDate: '2026-12-01',
    endDate: '2026-12-07',
    price: 12,
  };

  function rateTx(others: object[] = [], existing: object | null = {}) {
    return {
      room: { findUnique: jest.fn<Fn>(async () => ({ name: 'Salle A' })) },
      specialRate: {
        findUnique: jest.fn<Fn>(async () => existing),
        findMany: jest.fn<Fn>(async () => others),
        create: jest.fn<Fn>(async (args) => ({
          id: 'r1',
          ...(args as { data: object }).data,
        })),
        update: jest.fn<Fn>(async (args) => ({
          id: 'r1',
          ...(args as { data: object }).data,
        })),
      },
    };
  }

  it('creates a rate and returns calendar days', async () => {
    const tx = rateTx();
    mockTransaction(tx);
    expect(await service.saveSpecialRate(input)).toMatchObject({
      id: 'r1',
      roomName: 'Salle A',
      startDate: '2026-12-01',
      endDate: '2026-12-07',
      price: 12,
    });
  });

  it('rejects invalid and overlapping periods', async () => {
    await expect(
      service.saveSpecialRate({ ...input, endDate: '2026-11-01' }),
    ).rejects.toMatchObject({ reason: 'INVALID_PERIOD' });

    mockTransaction(
      rateTx([{ ...dayRangeToPeriod('2026-12-05', '2026-12-09')! }]),
    );
    await expect(service.saveSpecialRate(input)).rejects.toMatchObject({
      reason: 'RATE_OVERLAP',
    });
  });

  it('fails for an unknown room', async () => {
    const tx = rateTx();
    tx.room.findUnique.mockResolvedValue(null);
    mockTransaction(tx);
    await expect(service.saveSpecialRate(input)).rejects.toMatchObject({
      entity: 'room',
    });
  });

  it('updates, lists and deletes rates', async () => {
    const tx = rateTx();
    mockTransaction(tx);
    await service.saveSpecialRate(input, 'r1');
    expect(tx.specialRate.update).toHaveBeenCalled();

    tx.specialRate.findUnique.mockResolvedValue(null);
    await expect(service.saveSpecialRate(input, 'zz')).rejects.toMatchObject({
      entity: 'rate',
    });

    jest.spyOn(prisma.specialRate, 'findMany').mockResolvedValue([
      {
        id: 'r1',
        roomId: 'Salle A',
        label: 'F',
        price: 12,
        ...dayRangeToPeriod('2026-12-01', '2026-12-07')!,
      },
    ] as never);
    expect(await service.listSpecialRates()).toHaveLength(1);

    jest.spyOn(prisma.specialRate, 'findUnique').mockResolvedValue({} as never);
    const del = jest
      .spyOn(prisma.specialRate, 'delete')
      .mockResolvedValue({} as never);
    await service.deleteSpecialRate('r1');
    expect(del).toHaveBeenCalled();
    jest.spyOn(prisma.specialRate, 'findUnique').mockResolvedValue(null);
    await expect(service.deleteSpecialRate('r1')).rejects.toMatchObject({
      entity: 'rate',
    });
  });
});

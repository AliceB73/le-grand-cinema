import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import SeatMap from './SeatMap';
import type { ProgrammeItem } from './programme-api';
import {
  getSeatMap,
  getSeatSessionToken,
  holdSeats,
  SeatApiError,
} from './seat-api';

jest.mock('./seat-api', () => {
  class MockSeatApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    getSeatMap: jest.fn(),
    getSeatSessionToken: jest.fn(() => '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b'),
    holdSeats: jest.fn(),
    SeatApiError: MockSeatApiError,
  };
});

const screening: ProgrammeItem = {
  id: 'showtime-1',
  title: 'Les Veilleurs du Phare',
  genre: 'THRILLER',
  genreLabel: 'Thriller',
  duration: 108,
  posterUrl: null,
  roomName: 'Salle A',
  occupancyStatus: 'AVAILABLE',
  startTime: '2026-10-11T19:00:00.000Z',
};

const initialSeatMap = {
  showtimeId: 'showtime-1',
  seats: [
    {
      id: 'seat-free',
      rowNumber: 'A',
      seatNumber: 1,
      status: 'available' as const,
      heldByCurrentSession: false,
      expiresAt: null,
    },
    {
      id: 'seat-occupied',
      rowNumber: 'A',
      seatNumber: 2,
      status: 'occupied' as const,
      heldByCurrentSession: false,
      expiresAt: null,
    },
    {
      id: 'seat-held',
      rowNumber: 'A',
      seatNumber: 3,
      status: 'held' as const,
      heldByCurrentSession: false,
      expiresAt: '2026-10-11T19:10:00.000Z',
    },
    {
      id: 'seat-free-2',
      rowNumber: 'B',
      seatNumber: 1,
      status: 'available' as const,
      heldByCurrentSession: false,
      expiresAt: null,
    },
  ],
};

describe('SeatMap', () => {
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.mocked(getSeatMap).mockReset();
    jest.mocked(getSeatSessionToken).mockClear();
    jest.mocked(holdSeats).mockReset();
  });

  it('shows accessible states, supports multi-selection, and confirms a ten-minute hold', async () => {
    jest.useFakeTimers();
    jest
      .mocked(getSeatMap)
      .mockResolvedValueOnce(initialSeatMap)
      .mockResolvedValueOnce({
        ...initialSeatMap,
        seats: initialSeatMap.seats.map((seat) =>
          seat.id === 'seat-free'
            ? {
                ...seat,
                status: 'held' as const,
                heldByCurrentSession: true,
                expiresAt: '2026-10-11T19:10:00.000Z',
              }
            : seat,
        ),
      });
    jest.mocked(holdSeats).mockResolvedValue({
      heldSeatIds: ['seat-free', 'seat-free-2'],
      expiresAt: '2026-10-11T19:10:00.000Z',
    });

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const freeSeat = screen.getByRole('button', {
      name: 'Rangée A, siège 1, libre',
    });
    const occupiedSeat = screen.getByRole('button', {
      name: 'Rangée A, siège 2, occupé',
    }) as HTMLButtonElement;
    const heldSeat = screen.getByRole('button', {
      name: 'Rangée A, siège 3, réservé temporairement',
    }) as HTMLButtonElement;
    expect(occupiedSeat.disabled).toBe(true);
    expect(heldSeat.disabled).toBe(true);
    expect(freeSeat.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(freeSeat);
    expect(freeSeat.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Rangée B, siège 1, libre',
      }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Confirmer et réserver temporairement',
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(holdSeats).toHaveBeenCalledWith(
      'showtime-1',
      ['seat-free', 'seat-free-2'],
      '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b',
    );
    expect(
      screen.getByText(/Vos sièges sont réservés temporairement jusqu’à/),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Rangée A, siège 1, réservé temporairement par vous',
      }),
    ).toHaveProperty('disabled', true);
  });

  it('removes a seat that becomes unavailable and requires a replacement', async () => {
    jest.useFakeTimers();
    jest
      .mocked(getSeatMap)
      .mockResolvedValueOnce(initialSeatMap)
      .mockResolvedValue({
        ...initialSeatMap,
        seats: initialSeatMap.seats.map((seat) =>
          seat.id === 'seat-free' ? { ...seat, status: 'held' as const } : seat,
        ),
      });

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Rangée A, siège 1, libre' }),
    );
    expect(
      screen.getByRole('button', {
        name: 'Confirmer et réserver temporairement',
      }),
    ).toHaveProperty('disabled', false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });

    expect(
      screen.getByText(
        'Un siège sélectionné est devenu indisponible et a été retiré. Choisissez un autre siège avant de valider.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Rangée A, siège 1, réservé temporairement',
      }),
    ).toHaveProperty('disabled', true);
    expect(
      screen.getByRole('button', {
        name: 'Confirmer et réserver temporairement',
      }),
    ).toHaveProperty('disabled', true);

    fireEvent.click(
      screen.getByRole('button', { name: 'Rangée B, siège 1, libre' }),
    );
    expect(
      screen.getByRole('button', {
        name: 'Confirmer et réserver temporairement',
      }),
    ).toHaveProperty('disabled', false);
  });

  it('shows an explicit error when the browser cannot create a session', async () => {
    jest.mocked(getSeatSessionToken).mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });

    render(<SeatMap onClose={jest.fn()} screening={screening} />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Impossible de créer une session de sélection sur cet appareil.',
    );
    expect(getSeatMap).not.toHaveBeenCalled();
  });

  it('recovers from a failed availability refresh on the next poll', async () => {
    jest.useFakeTimers();
    jest
      .mocked(getSeatMap)
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValue(initialSeatMap);

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toBeTruthy();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Rangée A, siège 1, libre' }),
    ).toBeTruthy();
  });

  it('shows an empty state when a screening has no configured seats', async () => {
    jest.mocked(getSeatMap).mockResolvedValue({
      showtimeId: 'showtime-1',
      seats: [],
    });

    render(<SeatMap onClose={jest.fn()} screening={screening} />);

    expect(
      await screen.findByText('Aucun siège n’est configuré pour cette séance.'),
    ).toBeTruthy();
  });

  it('refreshes availability when another session takes a selected seat', async () => {
    jest.useFakeTimers();
    jest
      .mocked(getSeatMap)
      .mockResolvedValueOnce(initialSeatMap)
      .mockResolvedValueOnce(initialSeatMap);
    jest
      .mocked(holdSeats)
      .mockRejectedValue(
        new SeatApiError(409, 'SEAT_UNAVAILABLE', 'Seat is unavailable.'),
      );

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Rangée A, siège 1, libre' }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Confirmer et réserver temporairement',
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByText(
        'Un siège de votre sélection vient d’être pris. Actualisation de la disponibilité en cours.',
      ),
    ).toBeTruthy();
    expect(getSeatMap).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blocks confirmation and reports non-conflict hold failures', async () => {
    jest.mocked(getSeatMap).mockResolvedValue(initialSeatMap);
    jest.mocked(holdSeats).mockRejectedValue(new Error('Network unavailable'));

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await screen.findByRole('button', { name: 'Rangée A, siège 1, libre' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Rangée A, siège 1, libre' }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Confirmer et réserver temporairement',
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'La réservation temporaire n’a pas pu être créée.',
    );
    expect(
      screen.getByRole('button', {
        name: 'Confirmer et réserver temporairement',
      }),
    ).toHaveProperty('disabled', true);
  });
});

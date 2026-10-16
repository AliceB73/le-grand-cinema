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
import { createCheckout, PaymentApiError } from './payment-api';
import { redirectToCheckout } from './navigation';
import {
  getSeatMap,
  getSeatSessionToken,
  holdSeats,
  releaseSeats,
  SeatApiError,
} from './seat-api';

jest.mock('./payment-api', () => ({
  createCheckout: jest.fn(),
  PaymentApiError: class MockPaymentApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
jest.mock('./navigation', () => ({
  redirectToCheckout: jest.fn(),
}));

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
    releaseSeats: jest.fn(),
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
  priceCents: 950,
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
    {
      id: 'seat-free-3',
      rowNumber: 'B',
      seatNumber: 2,
      status: 'available' as const,
      heldByCurrentSession: false,
      expiresAt: null,
    },
  ],
};
async function clickAndWait(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SeatMap', () => {
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.mocked(getSeatMap).mockReset();
    jest.mocked(getSeatSessionToken).mockClear();
    jest.mocked(holdSeats).mockReset();
    jest.mocked(releaseSeats).mockReset();
    jest.mocked(createCheckout).mockReset();
    jest.mocked(redirectToCheckout).mockReset();
  });

  it('locks seats immediately, allows a fare per seat, and recalculates the total', async () => {
    jest.mocked(getSeatMap).mockResolvedValue(initialSeatMap);
    jest.mocked(holdSeats).mockImplementation(async (_showtime, seatIds) => ({
      heldSeatIds: seatIds,
      expiresAt: '2026-10-11T19:10:00.000Z',
    }));
    jest.mocked(releaseSeats).mockResolvedValue();

    render(<SeatMap onClose={jest.fn()} screening={screening} />);

    const seat1 = await screen.findByRole('button', {
      name: 'Rangée A, siège 1, libre',
    });
    await clickAndWait(seat1);
    await clickAndWait(
      screen.getByRole('button', { name: 'Rangée B, siège 1, libre' }),
    );
    await clickAndWait(
      screen.getByRole('button', { name: 'Rangée B, siège 2, libre' }),
    );

    expect(holdSeats).toHaveBeenNthCalledWith(
      1,
      'showtime-1',
      ['seat-free'],
      '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b',
    );
    expect(holdSeats).toHaveBeenNthCalledWith(
      2,
      'showtime-1',
      ['seat-free-2'],
      '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b',
    );
    expect(holdSeats).toHaveBeenNthCalledWith(
      3,
      'showtime-1',
      ['seat-free-3'],
      '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b',
    );

    fireEvent.change(screen.getByLabelText('Rangée A, siège 1'), {
      target: { value: 'reduced' },
    });
    fireEvent.change(screen.getByLabelText('Rangée B, siège 2'), {
      target: { value: 'reduced' },
    });

    expect(screen.getByText(/Total : 19,00/)).toBeTruthy();
    expect(
      screen
        .getByRole('button', {
          name: 'Rangée A, siège 1, sélectionné',
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.queryByRole('button', {
        name: 'Confirmer et réserver temporairement',
      }),
    ).toBeNull();
  });

  it('creates a Checkout session from selected seats and redirects to Stripe', async () => {
    jest.mocked(getSeatMap).mockResolvedValue(initialSeatMap);
    jest.mocked(holdSeats).mockImplementation(async (_showtime, seatIds) => ({
      heldSeatIds: seatIds,
      expiresAt: '2026-10-11T19:10:00.000Z',
    }));
    jest.mocked(releaseSeats).mockResolvedValue();
    jest.mocked(createCheckout).mockResolvedValue({
      id: 'cs_test_checkout-1',
      url: 'https://checkout.stripe.com/test',
    });
    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await clickAndWait(
      await screen.findByRole('button', {
        name: 'Rangée A, siège 1, libre',
      }),
    );
    fireEvent.change(screen.getByLabelText('Rangée A, siège 1'), {
      target: { value: 'reduced' },
    });
    await clickAndWait(screen.getByRole('button', { name: 'Payer par carte' }));

    expect(createCheckout).toHaveBeenCalledWith(
      'showtime-1',
      '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b',
      [{ seatId: 'seat-free', fare: 'reduced' }],
    );
    expect(redirectToCheckout).toHaveBeenCalledWith(
      'https://checkout.stripe.com/test',
    );
  });

  it('refreshes expired seats and displays payment failures', async () => {
    jest.mocked(getSeatMap).mockResolvedValue(initialSeatMap);
    jest.mocked(holdSeats).mockImplementation(async (_showtime, seatIds) => ({
      heldSeatIds: seatIds,
      expiresAt: '2026-10-11T19:10:00.000Z',
    }));
    jest.mocked(releaseSeats).mockResolvedValue();
    jest
      .mocked(createCheckout)
      .mockRejectedValueOnce(
        new PaymentApiError(
          409,
          'SEATS_UNAVAILABLE',
          'Un ou plusieurs sièges ne sont plus disponibles.',
        ),
      )
      .mockRejectedValueOnce(new Error('network unavailable'));

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await clickAndWait(
      await screen.findByRole('button', {
        name: 'Rangée A, siège 1, libre',
      }),
    );
    await clickAndWait(screen.getByRole('button', { name: 'Payer par carte' }));
    expect(
      await screen.findByText(
        'Un ou plusieurs sièges ne sont plus disponibles. Actualisez le plan puis réessayez.',
      ),
    ).toBeTruthy();
    expect(getSeatMap).toHaveBeenCalledTimes(2);

    await clickAndWait(
      screen.getByRole('button', { name: 'Rangée A, siège 1, libre' }),
    );
    await clickAndWait(screen.getByRole('button', { name: 'Payer par carte' }));
    expect(
      await screen.findByText(
        'Le paiement est momentanément indisponible. Réessayez.',
      ),
    ).toBeTruthy();
  });

  it('releases a selected seat immediately when it is deselected', async () => {
    jest.mocked(getSeatMap).mockResolvedValue(initialSeatMap);
    jest.mocked(holdSeats).mockResolvedValue({
      heldSeatIds: ['seat-free'],
      expiresAt: '2026-10-11T19:10:00.000Z',
    });
    jest.mocked(releaseSeats).mockResolvedValue();

    render(<SeatMap onClose={jest.fn()} screening={screening} />);

    await clickAndWait(
      await screen.findByRole('button', {
        name: 'Rangée A, siège 1, libre',
      }),
    );
    await clickAndWait(
      screen.getByRole('button', {
        name: 'Rangée A, siège 1, sélectionné',
      }),
    );

    expect(releaseSeats).toHaveBeenCalledWith(
      'showtime-1',
      ['seat-free'],
      '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b',
    );
    expect(screen.getByText('Aucun siège sélectionné.')).toBeTruthy();
    expect(screen.getByText(/Total : 0,00/)).toBeTruthy();
  });

  it('rounds a half-cent reduced fare to the nearest cent', async () => {
    jest.mocked(getSeatMap).mockResolvedValue({
      ...initialSeatMap,
      priceCents: 951,
    });
    jest.mocked(holdSeats).mockResolvedValue({
      heldSeatIds: ['seat-free'],
      expiresAt: '2026-10-11T19:10:00.000Z',
    });

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await clickAndWait(
      await screen.findByRole('button', {
        name: 'Rangée A, siège 1, libre',
      }),
    );
    fireEvent.change(screen.getByLabelText('Rangée A, siège 1'), {
      target: { value: 'reduced' },
    });

    expect(screen.getByText(/Total : 4,76/)).toBeTruthy();
  });

  it('releases all selected seats before returning to the programme', async () => {
    const onClose = jest.fn();
    jest.mocked(getSeatMap).mockResolvedValue(initialSeatMap);
    jest.mocked(holdSeats).mockResolvedValue({
      heldSeatIds: ['seat-free'],
      expiresAt: '2026-10-11T19:10:00.000Z',
    });
    jest.mocked(releaseSeats).mockResolvedValue();

    render(<SeatMap onClose={onClose} screening={screening} />);
    await clickAndWait(
      await screen.findByRole('button', {
        name: 'Rangée A, siège 1, libre',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Retour à la programmation' }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(releaseSeats).toHaveBeenLastCalledWith(
      'showtime-1',
      ['seat-free'],
      '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not select a seat that another session takes concurrently', async () => {
    jest.mocked(getSeatMap).mockResolvedValue(initialSeatMap);
    jest
      .mocked(holdSeats)
      .mockRejectedValue(
        new SeatApiError(409, 'SEATS_UNAVAILABLE', 'Seat is unavailable.'),
      );

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await clickAndWait(
      await screen.findByRole('button', {
        name: 'Rangée A, siège 1, libre',
      }),
    );

    expect(
      await screen.findByText(
        'Ce siège vient d’être pris par un autre spectateur. Actualisation de la disponibilité en cours.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Aucun siège sélectionné.')).toBeTruthy();
  });

  it('removes and announces a hold that expires without payment', async () => {
    jest.useFakeTimers();
    jest
      .mocked(getSeatMap)
      .mockResolvedValueOnce(initialSeatMap)
      .mockResolvedValue({
        ...initialSeatMap,
        seats: initialSeatMap.seats.map((seat) =>
          seat.id === 'seat-free'
            ? {
                ...seat,
                status: 'available' as const,
                heldByCurrentSession: false,
                expiresAt: null,
              }
            : seat,
        ),
      });
    jest.mocked(holdSeats).mockResolvedValue({
      heldSeatIds: ['seat-free'],
      expiresAt: '2026-10-11T19:10:00.000Z',
    });

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await clickAndWait(
      screen.getByRole('button', { name: 'Rangée A, siège 1, libre' }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });

    expect(
      screen.getByText(
        'Le verrou d’un siège a expiré ; il a été libéré et retiré de votre sélection.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Aucun siège sélectionné.')).toBeTruthy();
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

  it('shows an empty state when a screening has no configured seats', async () => {
    jest.mocked(getSeatMap).mockResolvedValue({
      ...initialSeatMap,
      seats: [],
    });

    render(<SeatMap onClose={jest.fn()} screening={screening} />);

    expect(
      await screen.findByText('Aucun siège n’est configuré pour cette séance.'),
    ).toBeTruthy();
  });

  it('reports an explicit error when releasing a selected seat fails', async () => {
    jest.mocked(getSeatMap).mockResolvedValue(initialSeatMap);
    jest.mocked(holdSeats).mockResolvedValue({
      heldSeatIds: ['seat-free'],
      expiresAt: '2026-10-11T19:10:00.000Z',
    });
    jest
      .mocked(releaseSeats)
      .mockRejectedValue(new Error('Network unavailable'));

    render(<SeatMap onClose={jest.fn()} screening={screening} />);
    await clickAndWait(
      await screen.findByRole('button', {
        name: 'Rangée A, siège 1, libre',
      }),
    );
    await clickAndWait(
      screen.getByRole('button', {
        name: 'Rangée A, siège 1, sélectionné',
      }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Le siège n’a pas pu être libéré.',
    );
    expect(screen.getByText(/Total : 9,50/)).toBeTruthy();
  });
});

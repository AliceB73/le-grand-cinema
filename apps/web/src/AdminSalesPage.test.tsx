import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import AdminSalesPage from './AdminSalesPage';
import * as api from './admin-api';

jest.mock('./admin-api', () => ({
  ...(jest.requireActual('./admin-api') as object),
  getSalesReport: jest.fn(),
  listMovies: jest.fn(),
  listRooms: jest.fn(),
  listShowtimes: jest.fn(),
}));

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  'createObjectURL',
);
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  'revokeObjectURL',
);

const report: api.AdminSalesReport = {
  totals: { revenueCents: 3250, ticketsSold: 3 },
  daily: [{ date: '2026-12-01', revenueCents: 3250, ticketsSold: 3 }],
  showtimes: [
    {
      showtimeId: 's1',
      startTime: '2026-12-01T18:00:00.000Z',
      movieId: 'm1',
      movieTitle: 'Film A',
      genre: 'DRAME',
      roomName: 'Salle A',
      revenueCents: 3250,
      ticketsSold: 3,
    },
  ],
};

function arrangeApi() {
  jest.mocked(api.getSalesReport).mockResolvedValue(report);
  jest.mocked(api.listMovies).mockResolvedValue([
    {
      id: 'm1',
      title: 'Film A',
      genre: 'DRAME',
      description: 'Description',
      duration: 100,
      posterUrl: null,
    },
  ]);
  jest.mocked(api.listRooms).mockResolvedValue([
    {
      name: 'Salle A',
      category: 'STANDARD',
      capacity: 100,
      rows: 10,
      columns: 10,
      defaultPrice: 9.5,
    },
  ]);
  jest.mocked(api.listShowtimes).mockResolvedValue([
    {
      id: 's1',
      movieId: 'm1',
      movieTitle: 'Film A',
      roomName: 'Salle A',
      startTime: '2026-12-01T18:00:00.000Z',
      endTime: '2026-12-01T19:40:00.000Z',
      price: 9.5,
      status: 'SCHEDULED',
      confirmedBookings: 1,
    },
  ]);
}

describe('AdminSalesPage', () => {
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('loads the report, displays sales by day and showtime, and refreshes every minute', async () => {
    arrangeApi();
    jest.useFakeTimers();
    render(<AdminSalesPage />);

    expect(await screen.findByRole('cell', { name: 'Film A' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Salle A' })).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Chiffre d’affaires par jour' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Chiffre d’affaires par séance' }),
    ).toBeTruthy();
    expect(api.getSalesReport).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(api.getSalesReport).toHaveBeenCalledTimes(2);
  });

  it('combines the selected genre, movie, room and showtime filters', async () => {
    arrangeApi();
    render(<AdminSalesPage />);
    await screen.findByRole('cell', { name: 'Film A' });

    fireEvent.change(screen.getByLabelText('Genre'), {
      target: { value: 'DRAME' },
    });
    fireEvent.change(screen.getByLabelText('Film'), {
      target: { value: 'm1' },
    });
    fireEvent.change(screen.getByLabelText('Salle'), {
      target: { value: 'Salle A' },
    });
    fireEvent.change(screen.getByLabelText('Séance'), {
      target: { value: 's1' },
    });

    await waitFor(() =>
      expect(api.getSalesReport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          genre: 'DRAME',
          movieId: 'm1',
          roomId: 'Salle A',
          showtimeId: 's1',
        }),
      ),
    );
  });

  it('downloads a CSV containing filtered session detail and totals', async () => {
    arrangeApi();
    let exportedBlob: Blob | null = null;
    const createObjectURL = jest.fn((blob: Blob) => {
      exportedBlob = blob;
      return 'blob:sales';
    });
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<AdminSalesPage />);
    await screen.findByRole('cell', { name: 'Film A' });

    fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));

    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = exportedBlob;
    if (!blob) {
      throw new Error('The CSV blob was not created.');
    }
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(csv).toContain('Film A');
    expect(csv).toContain('Chiffre d’affaires (EUR)');
    expect(csv).toContain('32.50');
    expect(csv).toContain('Places vendues');
  });
});

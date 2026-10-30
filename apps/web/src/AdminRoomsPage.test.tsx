import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import AdminRoomsPage from './AdminRoomsPage';
import * as api from './admin-api';

jest.mock('./admin-api', () => ({
  ...(jest.requireActual('./admin-api') as object),
  listRooms: jest.fn(),
  listSpecialRates: jest.fn(),
  updateRoom: jest.fn(),
  createSpecialRate: jest.fn(),
  deleteSpecialRate: jest.fn(),
}));

const room = {
  name: 'Salle A',
  category: 'STANDARD',
  capacity: 180,
  rows: 12,
  columns: 15,
  defaultPrice: 9.5,
};
const rate = {
  id: 'r1',
  roomName: 'Salle A',
  label: 'Festival',
  startDate: '2026-12-01',
  endDate: '2026-12-07',
  price: 12,
};

function setup(rates: (typeof rate)[] = []) {
  jest.mocked(api.listRooms).mockResolvedValue([room]);
  jest.mocked(api.listSpecialRates).mockResolvedValue(rates);
  render(<AdminRoomsPage />);
}

describe('AdminRoomsPage', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('shows an error when data cannot be loaded', async () => {
    jest.mocked(api.listRooms).mockRejectedValue(new Error('boom'));
    jest.mocked(api.listSpecialRates).mockResolvedValue([]);
    render(<AdminRoomsPage />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Impossible de charger les salles.',
    );
  });

  it('saves a new layout and default price', async () => {
    setup();
    jest.mocked(api.updateRoom).mockResolvedValue(room);
    fireEvent.change(await screen.findByLabelText('Lignes de Salle A'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText('Colonnes de Salle A'), {
      target: { value: '8' },
    });
    expect(screen.getByText('80')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Tarif par défaut de Salle A/), {
      target: { value: '11,5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Salle A mise à jour.',
      ),
    );
    expect(api.updateRoom).toHaveBeenCalledWith('Salle A', {
      rows: 10,
      columns: 8,
      defaultPrice: 11.5,
    });
  });

  it('rejects an invalid layout and reports API refusals', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('Lignes de Salle A'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('1 à 26');
    expect(api.updateRoom).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Lignes de Salle A'), {
      target: { value: '5' },
    });
    jest
      .mocked(api.updateRoom)
      .mockRejectedValue(
        new api.AdminApiError(409, 'Réservations existantes.'),
      );
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Réservations existantes.',
      ),
    );
  });

  it('creates a dated special rate', async () => {
    setup();
    jest.mocked(api.createSpecialRate).mockResolvedValue(rate);
    await screen.findByLabelText('Lignes de Salle A');
    fireEvent.change(screen.getByLabelText('Salle du tarif'), {
      target: { value: 'Salle A' },
    });
    fireEvent.change(screen.getByLabelText('Libellé'), {
      target: { value: ' Festival ' },
    });
    fireEvent.change(screen.getByLabelText('Début de période'), {
      target: { value: '2026-12-01' },
    });
    fireEvent.change(screen.getByLabelText('Fin de période'), {
      target: { value: '2026-12-07' },
    });
    fireEvent.change(screen.getByLabelText('Tarif spécial (€)'), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer le tarif' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Tarif spécial créé.',
      ),
    );
    expect(api.createSpecialRate).toHaveBeenCalledWith({
      roomName: 'Salle A',
      label: 'Festival',
      startDate: '2026-12-01',
      endDate: '2026-12-07',
      price: 12,
    });
  });

  it('requires every field of a special rate', async () => {
    setup();
    await screen.findByLabelText('Lignes de Salle A');
    fireEvent.click(screen.getByRole('button', { name: 'Créer le tarif' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Renseignez la salle',
    );
    expect(api.createSpecialRate).not.toHaveBeenCalled();
  });

  it('keeps the rate when the deletion is not confirmed or fails', async () => {
    setup([rate]);
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await screen.findByText(/du 2026-12-01 au 2026-12-07/);
    fireEvent.click(screen.getByRole('button', { name: /Supprimer/ }));
    expect(api.deleteSpecialRate).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    jest
      .mocked(api.deleteSpecialRate)
      .mockRejectedValue(new api.AdminApiError(404, 'Tarif introuvable.'));
    fireEvent.click(screen.getByRole('button', { name: /Supprimer/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Tarif introuvable.'),
    );
  });

  it('reports a failed special rate creation', async () => {
    setup();
    jest
      .mocked(api.createSpecialRate)
      .mockRejectedValue(new api.AdminApiError(409, 'Période déjà tarifée.'));
    await screen.findByLabelText('Lignes de Salle A');
    fireEvent.change(screen.getByLabelText('Salle du tarif'), {
      target: { value: 'Salle A' },
    });
    fireEvent.change(screen.getByLabelText('Libellé'), {
      target: { value: 'Festival' },
    });
    fireEvent.change(screen.getByLabelText('Début de période'), {
      target: { value: '2026-12-01' },
    });
    fireEvent.change(screen.getByLabelText('Fin de période'), {
      target: { value: '2026-12-07' },
    });
    fireEvent.change(screen.getByLabelText('Tarif spécial (€)'), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer le tarif' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Période déjà tarifée.',
      ),
    );
  });

  it('deletes a special rate after confirmation', async () => {
    setup([rate]);
    jest.mocked(api.deleteSpecialRate).mockResolvedValue(undefined);
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    expect(await screen.findByText(/du 2026-12-01 au 2026-12-07/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Supprimer/ }));
    await waitFor(() =>
      expect(api.deleteSpecialRate).toHaveBeenCalledWith('r1'),
    );
  });
});

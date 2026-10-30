import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createSpecialRate,
  deleteSpecialRate,
  describeAdminError,
  listRooms,
  listSpecialRates,
  updateRoom,
  type AdminRoom,
  type AdminSpecialRate,
} from './admin-api';
import {
  authFieldClassName,
  authPrimaryButtonClassName,
} from './auth-form-styles';

const secondaryButton =
  'rounded-lg border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 disabled:opacity-60';
const smallInput =
  'w-20 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1';

type Notify = (text: string, isError: boolean) => void;

function parsePrice(value: string) {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function RoomRow({
  onChanged,
  onMessage,
  room,
}: {
  onChanged: () => void;
  onMessage: Notify;
  room: AdminRoom;
}) {
  const [rows, setRows] = useState(String(room.rows));
  const [columns, setColumns] = useState(String(room.columns));
  const [price, setPrice] = useState(String(room.defaultPrice));
  const [isBusy, setIsBusy] = useState(false);
  const rowCount = Number(rows);
  const columnCount = Number(columns);

  async function save() {
    const defaultPrice = parsePrice(price);
    if (
      !Number.isInteger(rowCount) ||
      !Number.isInteger(columnCount) ||
      rowCount < 1 ||
      rowCount > 26 ||
      columnCount < 1 ||
      columnCount > 40 ||
      defaultPrice === null
    ) {
      onMessage(
        'Lignes : 1 à 26, colonnes : 1 à 40, tarif : nombre positif.',
        true,
      );
      return;
    }
    setIsBusy(true);
    try {
      await updateRoom(room.name, {
        rows: rowCount,
        columns: columnCount,
        defaultPrice,
      });
      onMessage(`${room.name} mise à jour.`, false);
      onChanged();
    } catch (error) {
      onMessage(describeAdminError(error), true);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <tr className="border-t border-slate-800 align-top">
      <th className="py-3 pr-3 font-semibold" scope="row">
        {room.name}
      </th>
      <td className="py-3 pr-3">
        <label className="sr-only" htmlFor={`rows-${room.name}`}>
          Lignes de {room.name}
        </label>
        <input
          className={smallInput}
          id={`rows-${room.name}`}
          inputMode="numeric"
          onChange={(event) => setRows(event.target.value)}
          value={rows}
        />
      </td>
      <td className="py-3 pr-3">
        <label className="sr-only" htmlFor={`columns-${room.name}`}>
          Colonnes de {room.name}
        </label>
        <input
          className={smallInput}
          id={`columns-${room.name}`}
          inputMode="numeric"
          onChange={(event) => setColumns(event.target.value)}
          value={columns}
        />
      </td>
      <td className="py-3 pr-3">
        {Number.isInteger(rowCount) && Number.isInteger(columnCount)
          ? rowCount * columnCount
          : '—'}
      </td>
      <td className="py-3 pr-3">
        <label className="sr-only" htmlFor={`price-${room.name}`}>
          Tarif par défaut de {room.name} en euros
        </label>
        <input
          className={smallInput}
          id={`price-${room.name}`}
          inputMode="decimal"
          onChange={(event) => setPrice(event.target.value)}
          value={price}
        />
      </td>
      <td className="py-3">
        <button
          className={secondaryButton}
          disabled={isBusy}
          onClick={() => void save()}
          type="button"
        >
          Enregistrer
          <span className="sr-only"> la salle {room.name}</span>
        </button>
      </td>
    </tr>
  );
}

export default function AdminRoomsPage() {
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [rates, setRates] = useState<AdminSpecialRate[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [roomName, setRoomName] = useState('');
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [price, setPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [nextRooms, nextRates] = await Promise.all([
        listRooms(),
        listSpecialRates(),
      ]);
      setRooms(nextRooms);
      setRates(nextRates);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const notify: Notify = (text, isError) => setFeedback({ text, isError });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = parsePrice(price);
    if (
      !roomName ||
      !label.trim() ||
      !startDate ||
      !endDate ||
      value === null
    ) {
      notify(
        'Renseignez la salle, le libellé, la période et un tarif positif.',
        true,
      );
      return;
    }
    setIsSubmitting(true);
    try {
      await createSpecialRate({
        roomName,
        label: label.trim(),
        startDate,
        endDate,
        price: value,
      });
      notify('Tarif spécial créé.', false);
      setLabel('');
      setStartDate('');
      setEndDate('');
      setPrice('');
      await reload();
    } catch (error) {
      notify(describeAdminError(error), true);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function remove(rate: AdminSpecialRate) {
    if (!window.confirm(`Supprimer le tarif « ${rate.label} » ?`)) {
      return;
    }
    try {
      await deleteSpecialRate(rate.id);
      notify('Tarif spécial supprimé.', false);
      await reload();
    } catch (error) {
      notify(describeAdminError(error), true);
    }
  }

  return (
    <div className="space-y-10">
      {feedback && (
        <p
          className={feedback.isError ? 'text-rose-200' : 'text-emerald-200'}
          role={feedback.isError ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      )}
      <section aria-labelledby="room-list" className="space-y-4">
        <h2 className="text-xl font-semibold" id="room-list">
          Salles
        </h2>
        <p className="text-sm text-slate-300">
          La disposition (lignes × colonnes) est reprise par le plan de salle
          public. Elle ne peut pas être modifiée si des séances à venir ont des
          réservations.
        </p>
        {loadError ? (
          <p className="text-rose-200" role="alert">
            Impossible de charger les salles.
          </p>
        ) : rooms === null ? (
          <p className="text-slate-300" role="status">
            Chargement des salles…
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Configuration des salles</caption>
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-2 pr-3" scope="col">
                    Salle
                  </th>
                  <th className="pb-2 pr-3" scope="col">
                    Lignes
                  </th>
                  <th className="pb-2 pr-3" scope="col">
                    Colonnes
                  </th>
                  <th className="pb-2 pr-3" scope="col">
                    Places
                  </th>
                  <th className="pb-2 pr-3" scope="col">
                    Tarif par défaut (€)
                  </th>
                  <th className="pb-2" scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <RoomRow
                    key={`${room.name}-${room.rows}-${room.columns}-${room.defaultPrice}`}
                    onChanged={() => void reload()}
                    onMessage={notify}
                    room={room}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="new-rate" className="space-y-4">
        <h2 className="text-xl font-semibold" id="new-rate">
          Tarif spécial daté
        </h2>
        <p className="text-sm text-slate-300">
          S’applique automatiquement aux séances de la salle créées pendant la
          période (jours inclus). Les séances existantes ne changent pas.
        </p>
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <label className="block text-sm font-semibold">
            Salle du tarif
            <select
              className={authFieldClassName}
              onChange={(event) => setRoomName(event.target.value)}
              value={roomName}
            >
              <option value="">Choisir une salle</option>
              {(rooms ?? []).map((room) => (
                <option key={room.name} value={room.name}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Libellé
            <input
              className={authFieldClassName}
              onChange={(event) => setLabel(event.target.value)}
              value={label}
            />
          </label>
          <label className="block text-sm font-semibold">
            Début de période
            <input
              className={authFieldClassName}
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              value={startDate}
            />
          </label>
          <label className="block text-sm font-semibold">
            Fin de période
            <input
              className={authFieldClassName}
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </label>
          <label className="block text-sm font-semibold">
            Tarif spécial (€)
            <input
              className={authFieldClassName}
              inputMode="decimal"
              onChange={(event) => setPrice(event.target.value)}
              value={price}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              className={authPrimaryButtonClassName}
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? 'Création…' : 'Créer le tarif'}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="rate-list" className="space-y-4">
        <h2 className="text-xl font-semibold" id="rate-list">
          Tarifs spéciaux
        </h2>
        {rates.length === 0 ? (
          <p className="text-slate-300">Aucun tarif spécial.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {rates.map((rate) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-2"
                key={rate.id}
              >
                <span>
                  <span className="font-semibold">{rate.label}</span> —{' '}
                  {rate.roomName}, du {rate.startDate} au {rate.endDate} :{' '}
                  {rate.price.toFixed(2)} €
                </span>
                <button
                  className={secondaryButton}
                  onClick={() => void remove(rate)}
                  type="button"
                >
                  Supprimer
                  <span className="sr-only"> le tarif {rate.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

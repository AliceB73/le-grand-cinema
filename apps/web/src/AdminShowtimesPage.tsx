import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  cancelShowtime,
  createShowtime,
  describeAdminError,
  listMovies,
  listRooms,
  listShowtimes,
  updateShowtimePrice,
  type AdminMovie,
  type AdminRoom,
  type AdminShowtime,
} from './admin-api';
import {
  authFieldClassName,
  authPrimaryButtonClassName,
} from './auth-form-styles';

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'short',
  timeStyle: 'short',
});
const secondaryButton =
  'rounded-lg border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 disabled:opacity-60';

function ShowtimeRow({
  onChanged,
  onMessage,
  showtime,
}: {
  onChanged: () => void;
  onMessage: (message: string, isError: boolean) => void;
  showtime: AdminShowtime;
}) {
  const [price, setPrice] = useState(String(showtime.price));
  const [isBusy, setIsBusy] = useState(false);
  const cancelled = showtime.status === 'CANCELLED';
  const label = `${showtime.movieTitle}, ${showtime.roomName}, ${dateTimeFormatter.format(new Date(showtime.startTime))}`;

  async function savePrice() {
    const value = Number(price.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      onMessage('Le prix doit être un nombre positif.', true);
      return;
    }
    setIsBusy(true);
    try {
      await updateShowtimePrice(showtime.id, value);
      onMessage('Prix mis à jour.', false);
      onChanged();
    } catch (error) {
      onMessage(describeAdminError(error), true);
    } finally {
      setIsBusy(false);
    }
  }

  async function cancel() {
    const warning =
      showtime.confirmedBookings > 0
        ? `${showtime.confirmedBookings} réservation(s) confirmée(s) : les spectateurs seront prévenus par e-mail. `
        : '';
    if (!window.confirm(`${warning}Annuler la séance ${label} ?`)) {
      return;
    }
    setIsBusy(true);
    try {
      const result = await cancelShowtime(showtime.id);
      onMessage(
        `Séance annulée. ${result.notifiedBookings} spectateur(s) notifié(s).`,
        false,
      );
      onChanged();
    } catch (error) {
      onMessage(describeAdminError(error), true);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <tr className="border-t border-slate-800 align-top">
      <td className="py-3 pr-3">
        <span className="font-semibold">{showtime.movieTitle}</span>
        {cancelled && (
          <span className="ml-2 rounded-full border border-rose-400/40 px-2 py-0.5 text-xs text-rose-200">
            Annulée
          </span>
        )}
      </td>
      <td className="py-3 pr-3">{showtime.roomName}</td>
      <td className="py-3 pr-3">
        {dateTimeFormatter.format(new Date(showtime.startTime))}
      </td>
      <td className="py-3 pr-3">{showtime.confirmedBookings}</td>
      <td className="py-3 pr-3">
        {cancelled ? (
          `${showtime.price.toFixed(2)} €`
        ) : (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`price-${showtime.id}`}>
              Prix en euros pour {label}
            </label>
            <input
              className="w-20 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1"
              id={`price-${showtime.id}`}
              inputMode="decimal"
              onChange={(event) => setPrice(event.target.value)}
              value={price}
            />
            <button
              className={secondaryButton}
              disabled={isBusy || Number(price) === showtime.price}
              onClick={() => void savePrice()}
              type="button"
            >
              Enregistrer
              <span className="sr-only"> le prix pour {label}</span>
            </button>
          </div>
        )}
      </td>
      <td className="py-3">
        {!cancelled && (
          <button
            className={secondaryButton}
            disabled={isBusy}
            onClick={() => void cancel()}
            type="button"
          >
            Annuler
            <span className="sr-only"> la séance {label}</span>
          </button>
        )}
      </td>
    </tr>
  );
}

export default function AdminShowtimesPage() {
  const [showtimes, setShowtimes] = useState<AdminShowtime[] | null>(null);
  const [movies, setMovies] = useState<AdminMovie[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [movieId, setMovieId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [price, setPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [nextShowtimes, nextMovies, nextRooms] = await Promise.all([
        listShowtimes(),
        listMovies(),
        listRooms(),
      ]);
      setShowtimes(nextShowtimes);
      setMovies(nextMovies);
      setRooms(nextRooms);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedPrice = price.trim();
    const value =
      trimmedPrice === '' ? undefined : Number(trimmedPrice.replace(',', '.'));
    const date = new Date(startTime);
    if (
      !movieId ||
      !roomId ||
      Number.isNaN(date.getTime()) ||
      (value !== undefined && (!Number.isFinite(value) || value <= 0))
    ) {
      setFeedback({
        text: 'Renseignez le film, la salle, la date, l’horaire et, si vous le précisez, un prix positif.',
        isError: true,
      });
      return;
    }
    setIsSubmitting(true);
    try {
      await createShowtime({
        movieId,
        roomId,
        startTime: date.toISOString(),
        ...(value === undefined ? {} : { price: value }),
      });
      setFeedback({ text: 'Séance créée.', isError: false });
      setStartTime('');
      await reload();
    } catch (error) {
      setFeedback({ text: describeAdminError(error), isError: true });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="new-showtime" className="space-y-4">
        <h2 className="text-xl font-semibold" id="new-showtime">
          Programmer une séance
        </h2>
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <label className="block text-sm font-semibold">
            Film
            <select
              className={authFieldClassName}
              onChange={(event) => setMovieId(event.target.value)}
              required
              value={movieId}
            >
              <option value="">Choisir un film</option>
              {movies.map((movie) => (
                <option key={movie.id} value={movie.id}>
                  {movie.title} ({movie.duration} min)
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Salle
            <select
              className={authFieldClassName}
              onChange={(event) => setRoomId(event.target.value)}
              required
              value={roomId}
            >
              <option value="">Choisir une salle</option>
              {rooms.map((room) => (
                <option key={room.name} value={room.name}>
                  {room.name} ({room.capacity} places)
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Date et horaire
            <input
              className={authFieldClassName}
              onChange={(event) => setStartTime(event.target.value)}
              required
              type="datetime-local"
              value={startTime}
            />
          </label>
          <label className="block text-sm font-semibold">
            Prix (€), vide = tarif de la salle
            <input
              className={authFieldClassName}
              inputMode="decimal"
              onChange={(event) => setPrice(event.target.value)}
              placeholder="Tarif automatique"
              value={price}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              className={authPrimaryButtonClassName}
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? 'Création…' : 'Créer la séance'}
            </button>
          </div>
        </form>
        {feedback && (
          <p
            className={feedback.isError ? 'text-rose-200' : 'text-emerald-200'}
            role={feedback.isError ? 'alert' : 'status'}
          >
            {feedback.text}
          </p>
        )}
      </section>

      <section aria-labelledby="showtime-list" className="space-y-4">
        <h2 className="text-xl font-semibold" id="showtime-list">
          Séances
        </h2>
        {loadError ? (
          <p className="text-rose-200" role="alert">
            Impossible de charger les séances.
          </p>
        ) : showtimes === null ? (
          <p className="text-slate-300" role="status">
            Chargement des séances…
          </p>
        ) : showtimes.length === 0 ? (
          <p className="text-slate-300">Aucune séance programmée.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Liste des séances</caption>
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-2 pr-3" scope="col">
                    Film
                  </th>
                  <th className="pb-2 pr-3" scope="col">
                    Salle
                  </th>
                  <th className="pb-2 pr-3" scope="col">
                    Début
                  </th>
                  <th className="pb-2 pr-3" scope="col">
                    Réservations
                  </th>
                  <th className="pb-2 pr-3" scope="col">
                    Prix (€)
                  </th>
                  <th className="pb-2" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {showtimes.map((showtime) => (
                  <ShowtimeRow
                    key={showtime.id}
                    onChanged={() => void reload()}
                    onMessage={(text, isError) =>
                      setFeedback({ text, isError })
                    }
                    showtime={showtime}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

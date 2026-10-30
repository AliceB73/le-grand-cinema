import { useEffect, useState } from 'react';
import {
  GENRES,
  describeAdminError,
  getSalesReport,
  listMovies,
  listRooms,
  listShowtimes,
  type AdminMovie,
  type AdminRoom,
  type AdminSalesReport,
  type AdminShowtime,
} from './admin-api';
import { authFieldClassName } from './auth-form-styles';

const TIME_ZONE = 'Europe/Paris';

function parisDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function initialDateRange() {
  const endDate = parisDate();
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIME_ZONE,
  }).format(new Date(value));
}

function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportSalesCsv(
  report: AdminSalesReport,
  startDate: string,
  endDate: string,
) {
  const rows = [
    [
      'Date de séance',
      'Séance',
      'Film',
      'Genre',
      'Salle',
      'Chiffre d’affaires (EUR)',
      'Places vendues',
    ],
    ...report.showtimes.map((showtime) => [
      formatDateTime(showtime.startTime),
      showtime.showtimeId,
      showtime.movieTitle,
      showtime.genre,
      showtime.roomName,
      (showtime.revenueCents / 100).toFixed(2),
      showtime.ticketsSold,
    ]),
    [
      'Totaux',
      '',
      '',
      '',
      '',
      (report.totals.revenueCents / 100).toFixed(2),
      report.totals.ticketsSold,
    ],
  ];
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `ventes-${startDate}-${endDate}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function SalesBarChart({
  title,
  items,
}: {
  title: string;
  items: { key: string; label: string; value: number; description: string }[];
}) {
  const max = Math.max(1, ...items.map(({ value }) => value));
  const chartWidth = Math.max(640, items.length * 22);
  const slotWidth = items.length ? chartWidth / items.length : 640;
  const barWidth = Math.max(2, Math.min(24, slotWidth * 0.62));
  const chartHeight = 150;

  return (
    <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-900 p-4">
      <h3 className="mb-3 text-lg font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-300">
          Aucune vente confirmée sur cette période.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <svg
            aria-label={title}
            className="h-48 min-w-full"
            role="img"
            viewBox={`0 0 ${chartWidth} 190`}
          >
            {items.map((item, index) => {
              const x = index * slotWidth + (slotWidth - barWidth) / 2;
              const height = (item.value / max) * chartHeight;
              const labelStep = Math.ceil(items.length / 12);
              return (
                <g key={item.key}>
                  <rect
                    fill="#fcd34d"
                    height={height}
                    rx="3"
                    width={barWidth}
                    x={x}
                    y={chartHeight - height}
                  >
                    <title>{item.description}</title>
                  </rect>
                  {index % labelStep === 0 && (
                    <text
                      fill="#cbd5e1"
                      fontSize="10"
                      textAnchor="middle"
                      x={x + barWidth / 2}
                      y="170"
                    >
                      {item.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <ul className="sr-only">
            {items.map((item) => (
              <li key={item.key}>{item.description}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function AdminSalesPage() {
  const initialPeriod = initialDateRange();
  const [startDate, setStartDate] = useState(initialPeriod.startDate);
  const [endDate, setEndDate] = useState(initialPeriod.endDate);
  const [genre, setGenre] = useState('');
  const [movieId, setMovieId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [showtimeId, setShowtimeId] = useState('');
  const [movies, setMovies] = useState<AdminMovie[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [showtimes, setShowtimes] = useState<AdminShowtime[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [report, setReport] = useState<AdminSalesReport | null>(null);
  const [reportFiltersKey, setReportFiltersKey] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const currentFiltersKey = JSON.stringify([
    startDate,
    endDate,
    genre,
    movieId,
    roomId,
    showtimeId,
  ]);
  const currentReport =
    report && reportFiltersKey === currentFiltersKey ? report : null;

  useEffect(() => {
    let active = true;
    Promise.all([listMovies(), listRooms(), listShowtimes()])
      .then(([loadedMovies, loadedRooms, loadedShowtimes]) => {
        if (!active) {
          return;
        }
        setMovies(loadedMovies);
        setRooms(loadedRooms);
        setShowtimes(loadedShowtimes);
        setOptionsError(false);
      })
      .catch(() => active && setOptionsError(true));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const reload = async () => {
      setReportError(null);
      if (!startDate || !endDate || startDate > endDate) {
        setReportError(
          'La date de début doit précéder ou être égale à la date de fin.',
        );
        return;
      }
      try {
        const nextReport = await getSalesReport({
          startDate,
          endDate,
          ...(genre ? { genre } : {}),
          ...(movieId ? { movieId } : {}),
          ...(roomId ? { roomId } : {}),
          ...(showtimeId ? { showtimeId } : {}),
        });
        if (!active) {
          return;
        }
        setReport(nextReport);
        setReportFiltersKey(currentFiltersKey);
        setReportError(null);
        setLastUpdated(new Date());
      } catch (error) {
        if (active) {
          setReportError(describeAdminError(error));
        }
      }
    };

    void reload();
    const intervalId = window.setInterval(() => void reload(), 60_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [
    startDate,
    endDate,
    genre,
    movieId,
    roomId,
    showtimeId,
    currentFiltersKey,
  ]);

  const dailyChart = (currentReport?.daily ?? []).map((day) => ({
    key: day.date,
    label: day.date.slice(5),
    value: day.revenueCents,
    description: `${day.date} : ${formatCurrency(day.revenueCents)}, ${day.ticketsSold} places vendues`,
  }));
  const showtimeChart = (currentReport?.showtimes ?? []).map((showtime) => ({
    key: showtime.showtimeId,
    label: showtime.showtimeId.slice(0, 6),
    value: showtime.revenueCents,
    description: `${formatDateTime(showtime.startTime)} — ${showtime.movieTitle}, ${showtime.roomName} : ${formatCurrency(showtime.revenueCents)}, ${showtime.ticketsSold} places vendues`,
  }));

  return (
    <section aria-labelledby="admin-sales-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold" id="admin-sales-title">
            Tableau de bord des ventes
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Ventes confirmées par date de séance, heure de Paris.
          </p>
        </div>
        <button
          className="rounded-lg border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!currentReport || Boolean(reportError)}
          onClick={() =>
            currentReport && exportSalesCsv(currentReport, startDate, endDate)
          }
          type="button"
        >
          Exporter en CSV
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1 text-sm font-medium">
          Date de début
          <input
            className={authFieldClassName}
            onChange={(event) => setStartDate(event.target.value)}
            type="date"
            value={startDate}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Date de fin
          <input
            className={authFieldClassName}
            onChange={(event) => setEndDate(event.target.value)}
            type="date"
            value={endDate}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Genre
          <select
            className={authFieldClassName}
            onChange={(event) => setGenre(event.target.value)}
            value={genre}
          >
            <option value="">Tous les genres</option>
            {GENRES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Film
          <select
            className={authFieldClassName}
            onChange={(event) => setMovieId(event.target.value)}
            value={movieId}
          >
            <option value="">Tous les films</option>
            {movies.map((movie) => (
              <option key={movie.id} value={movie.id}>
                {movie.title}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Salle
          <select
            className={authFieldClassName}
            onChange={(event) => setRoomId(event.target.value)}
            value={roomId}
          >
            <option value="">Toutes les salles</option>
            {rooms.map((room) => (
              <option key={room.name} value={room.name}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Séance
          <select
            className={authFieldClassName}
            onChange={(event) => setShowtimeId(event.target.value)}
            value={showtimeId}
          >
            <option value="">Toutes les séances</option>
            {showtimes.map((showtime) => (
              <option key={showtime.id} value={showtime.id}>
                {showtime.movieTitle} — {formatDateTime(showtime.startTime)} —{' '}
                {showtime.roomName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {optionsError && (
        <p className="text-rose-200" role="alert">
          Impossible de charger les options de filtre. Rechargez la page pour
          réessayer.
        </p>
      )}
      {reportError && (
        <p className="text-rose-200" role="alert">
          {reportError}
        </p>
      )}
      <p className="text-sm text-slate-300" role="status">
        {lastUpdated && currentReport
          ? `Actualisé à ${new Intl.DateTimeFormat('fr-FR', {
              timeStyle: 'short',
              timeZone: TIME_ZONE,
            }).format(
              lastUpdated,
            )}. Actualisation automatique toutes les 60 secondes.`
          : 'Chargement des ventes…'}
      </p>

      {currentReport && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-xl border border-slate-700 bg-slate-900 p-5">
              <h3 className="text-sm font-semibold text-slate-300">
                Chiffre d’affaires confirmé
              </h3>
              <p className="mt-2 text-3xl font-bold text-amber-300">
                {formatCurrency(currentReport.totals.revenueCents)}
              </p>
            </article>
            <article className="rounded-xl border border-slate-700 bg-slate-900 p-5">
              <h3 className="text-sm font-semibold text-slate-300">
                Places vendues
              </h3>
              <p className="mt-2 text-3xl font-bold text-amber-300">
                {currentReport.totals.ticketsSold}
              </p>
            </article>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SalesBarChart
              title="Chiffre d’affaires par jour"
              items={dailyChart}
            />
            <SalesBarChart
              title="Chiffre d’affaires par séance"
              items={showtimeChart}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="min-w-full divide-y divide-slate-700 text-left text-sm">
              <caption className="px-4 py-3 text-left text-lg font-semibold">
                Détail des séances
              </caption>
              <thead className="bg-slate-900 text-slate-200">
                <tr>
                  <th className="px-4 py-3" scope="col">
                    Date et heure
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Film
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Genre
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Salle
                  </th>
                  <th className="px-4 py-3 text-right" scope="col">
                    Chiffre d’affaires
                  </th>
                  <th className="px-4 py-3 text-right" scope="col">
                    Places vendues
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {currentReport.showtimes.map((showtime) => (
                  <tr key={showtime.showtimeId}>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateTime(showtime.startTime)}
                    </td>
                    <td className="px-4 py-3">{showtime.movieTitle}</td>
                    <td className="px-4 py-3">
                      {GENRES.find(
                        ([value]) => value === showtime.genre,
                      )?.[1] ?? showtime.genre}
                    </td>
                    <td className="px-4 py-3">{showtime.roomName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {formatCurrency(showtime.revenueCents)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {showtime.ticketsSold}
                    </td>
                  </tr>
                ))}
                {currentReport.showtimes.length === 0 && (
                  <tr>
                    <td className="px-4 py-5 text-slate-300" colSpan={6}>
                      Aucune vente confirmée pour les filtres sélectionnés.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

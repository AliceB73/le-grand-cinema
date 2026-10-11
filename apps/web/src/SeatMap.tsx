import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProgrammeItem } from './programme-api';
import {
  getSeatMap,
  getSeatSessionToken,
  holdSeats,
  SeatApiError,
  type SeatMap as SeatMapData,
  type SeatMapItem,
} from './seat-api';

const screeningTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

type SeatMapProps = {
  screening: ProgrammeItem;
  onClose: () => void;
};

function statusLabel(seat: SeatMapItem, isSelected: boolean) {
  if (isSelected) {
    return 'sélectionné';
  }

  if (seat.status === 'occupied') {
    return 'occupé';
  }

  if (seat.status === 'held') {
    return seat.heldByCurrentSession
      ? 'réservé temporairement par vous'
      : 'réservé temporairement';
  }

  return 'libre';
}

export default function SeatMap({ screening, onClose }: SeatMapProps) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [seatMap, setSeatMap] = useState<SeatMapData | null>(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [selectionNeedsReplacement, setSelectionNeedsReplacement] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      setSessionToken(getSeatSessionToken());
    } catch {
      setLoadError(
        'Impossible de créer une session de sélection sur cet appareil. Vérifiez les paramètres du navigateur puis réessayez.',
      );
    }
  }, []);

  const refreshSeatMap = useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionToken) {
        return;
      }

      try {
        const updatedSeatMap = await getSeatMap(
          screening.id,
          sessionToken,
          signal,
        );
        setSeatMap(updatedSeatMap);
        setLoadError(null);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }

        setLoadError(
          'La disponibilité des sièges est momentanément indisponible. La validation est suspendue ; réessayez dans un instant.',
        );
      }
    },
    [screening.id, sessionToken],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }

    const controller = new AbortController();
    let isRequestPending = false;

    const refresh = async () => {
      if (isRequestPending) {
        return;
      }

      isRequestPending = true;
      try {
        await refreshSeatMap(controller.signal);
      } finally {
        isRequestPending = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refreshSeatMap, sessionToken]);

  useEffect(() => {
    if (!seatMap || selectedSeatIds.length === 0) {
      return;
    }

    const availableIds = new Set(
      seatMap.seats
        .filter((seat) => seat.status === 'available')
        .map((seat) => seat.id),
    );
    const unavailableIds = selectedSeatIds.filter(
      (seatId) => !availableIds.has(seatId),
    );

    if (unavailableIds.length === 0) {
      return;
    }

    setSelectedSeatIds((current) =>
      current.filter((seatId) => availableIds.has(seatId)),
    );
    setSelectionNeedsReplacement((current) =>
      Math.max(current, selectedSeatIds.length),
    );
    setAnnouncement(
      unavailableIds.length === 1
        ? 'Un siège sélectionné est devenu indisponible et a été retiré. Choisissez un autre siège avant de valider.'
        : 'Des sièges sélectionnés sont devenus indisponibles et ont été retirés. Choisissez des sièges de remplacement avant de valider.',
    );
  }, [seatMap, selectedSeatIds]);

  const rows = useMemo(() => {
    const grouped = new Map<string, SeatMapItem[]>();

    for (const seat of seatMap?.seats ?? []) {
      const row = grouped.get(seat.rowNumber) ?? [];
      row.push(seat);
      grouped.set(seat.rowNumber, row);
    }

    return Array.from(grouped.entries())
      .sort(([first], [second]) => first.localeCompare(second, 'fr'))
      .map(
        ([rowNumber, seats]) =>
          [
            rowNumber,
            seats.sort((first, second) => first.seatNumber - second.seatNumber),
          ] as const,
      );
  }, [seatMap]);

  function toggleSeat(seat: SeatMapItem) {
    if (seat.status !== 'available') {
      return;
    }

    setSelectedSeatIds((current) => {
      const next = current.includes(seat.id)
        ? current.filter((seatId) => seatId !== seat.id)
        : [...current, seat.id];

      if (next.length >= selectionNeedsReplacement) {
        setSelectionNeedsReplacement(0);
      }

      return next;
    });
  }

  async function confirmSelection() {
    if (!sessionToken || selectedSeatIds.length === 0 || loadError) {
      return;
    }

    setIsSubmitting(true);
    setAnnouncement('');

    try {
      const hold = await holdSeats(screening.id, selectedSeatIds, sessionToken);
      setSelectedSeatIds([]);
      setSelectionNeedsReplacement(0);
      setAnnouncement(
        `Vos ${hold.heldSeatIds.length > 1 ? 'sièges sont réservés' : 'siège est réservé'} temporairement jusqu’à ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(hold.expiresAt))}.`,
      );
      await refreshSeatMap();
    } catch (error) {
      if (error instanceof SeatApiError && error.status === 409) {
        setAnnouncement(
          'Un siège de votre sélection vient d’être pris. Actualisation de la disponibilité en cours.',
        );
        await refreshSeatMap();
      } else {
        setLoadError(
          'La réservation temporaire n’a pas pu être créée. Vérifiez votre connexion puis réessayez.',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const canConfirm =
    selectedSeatIds.length > 0 &&
    selectedSeatIds.length >= selectionNeedsReplacement &&
    !isSubmitting &&
    loadError === null;

  return (
    <section
      aria-labelledby="seat-map-title"
      className="space-y-8"
      aria-busy={seatMap === null}
    >
      <div>
        <button
          className="mb-5 rounded-lg border border-slate-600 px-4 py-2 font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          onClick={onClose}
          type="button"
        >
          Retour à la programmation
        </button>
        <p className="text-sm font-semibold text-amber-300">
          {screening.roomName}
        </p>
        <h2
          className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl"
          id="seat-map-title"
          ref={headingRef}
          tabIndex={-1}
        >
          Choisissez vos places
        </h2>
        <p className="mt-2 text-slate-300">
          {screening.title} ·{' '}
          {screeningTimeFormatter.format(new Date(screening.startTime))}
        </p>
      </div>

      {loadError && (
        <p
          className="rounded-xl border border-rose-400/40 bg-rose-950/40 p-4 text-rose-100"
          role="alert"
        >
          {loadError}
        </p>
      )}

      {seatMap === null && !loadError && (
        <p className="text-slate-300" role="status">
          Chargement du plan de salle…
        </p>
      )}

      {seatMap !== null && seatMap.seats.length === 0 && (
        <p
          className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-slate-300"
          role="status"
        >
          Aucun siège n’est configuré pour cette séance.
        </p>
      )}

      {seatMap !== null && seatMap.seats.length > 0 && (
        <>
          <section aria-label="Légende des états de siège">
            <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-200">
              <li>
                <span aria-hidden="true">○</span> — Libre
              </li>
              <li>
                <span aria-hidden="true">×</span> — Occupé
              </li>
              <li>
                <span aria-hidden="true">R</span> — Réservé temporairement
              </li>
              <li>
                <span aria-hidden="true">✓</span> — Sélectionné
              </li>
            </ul>
          </section>

          <div
            aria-label="Plan de salle, sélectionnez un ou plusieurs sièges"
            className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6"
            role="group"
          >
            <div
              aria-hidden="true"
              className="mx-auto mb-8 w-full max-w-3xl rounded-b-[50%] border-x border-b border-slate-500 pb-3 text-center text-xs font-semibold uppercase tracking-[0.3em] text-slate-400"
            >
              Écran
            </div>
            <div className="mx-auto w-max space-y-3">
              {rows.map(([rowNumber, seats]) => (
                <div
                  aria-label={`Rangée ${rowNumber}`}
                  className="flex items-center gap-3"
                  key={rowNumber}
                  role="group"
                >
                  <span
                    aria-hidden="true"
                    className="w-5 text-center text-sm text-slate-400"
                  >
                    {rowNumber}
                  </span>
                  <div className="flex gap-2">
                    {seats.map((seat) => {
                      const isSelected = selectedSeatIds.includes(seat.id);
                      const label = statusLabel(seat, isSelected);
                      const marker = isSelected
                        ? '✓'
                        : seat.status === 'occupied'
                          ? '×'
                          : seat.status === 'held'
                            ? 'R'
                            : '';
                      const statusClass = isSelected
                        ? 'border-amber-200 bg-amber-300 text-slate-950'
                        : seat.status === 'occupied'
                          ? 'cursor-not-allowed border-rose-300 bg-rose-950 text-rose-100'
                          : seat.status === 'held'
                            ? 'cursor-not-allowed border-sky-300 bg-sky-950 text-sky-100'
                            : 'border-emerald-300 bg-emerald-950 text-emerald-100 hover:bg-emerald-800';

                      return (
                        <button
                          aria-label={`Rangée ${rowNumber}, siège ${seat.seatNumber}, ${label}`}
                          aria-pressed={isSelected}
                          className={`flex h-11 min-w-11 items-center justify-center gap-1 rounded-t-xl border text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${statusClass}`}
                          disabled={seat.status !== 'available'}
                          key={seat.id}
                          onClick={() => toggleSeat(seat)}
                          type="button"
                        >
                          <span>{seat.seatNumber}</span>
                          {marker && <span aria-hidden="true">{marker}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <span
                    aria-hidden="true"
                    className="w-5 text-center text-sm text-slate-400"
                  >
                    {rowNumber}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <p aria-live="polite" className="text-slate-200">
              {selectedSeatIds.length === 0
                ? 'Aucun siège sélectionné.'
                : `${selectedSeatIds.length} siège${selectedSeatIds.length > 1 ? 's' : ''} sélectionné${selectedSeatIds.length > 1 ? 's' : ''}.`}
            </p>
            <button
              className="rounded-lg bg-amber-300 px-5 py-3 font-semibold text-slate-950 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canConfirm}
              onClick={() => void confirmSelection()}
              type="button"
            >
              {isSubmitting
                ? 'Validation…'
                : 'Confirmer et réserver temporairement'}
            </button>
          </div>
        </>
      )}

      <p aria-live="assertive" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

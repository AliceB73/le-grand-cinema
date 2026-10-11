import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProgrammeItem } from './programme-api';
import {
  getSeatMap,
  getSeatSessionToken,
  holdSeats,
  releaseSeats,
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
const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

type TicketFare = 'full' | 'reduced';

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
  const [ticketFares, setTicketFares] = useState<Record<string, TicketFare>>(
    {},
  );
  const [pendingSeatIds, setPendingSeatIds] = useState<string[]>([]);
  const [isClosing, setIsClosing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const selectedSeatIdsRef = useRef<string[]>([]);
  const pendingSeatIdsRef = useRef<string[]>([]);
  const pendingOperationsRef = useRef<Promise<void>[]>([]);
  const sessionTokenRef = useRef<string | null>(null);

  const updateSelectedSeatIds = useCallback(
    (update: (current: string[]) => string[]) => {
      const next = update(selectedSeatIdsRef.current);
      selectedSeatIdsRef.current = next;
      setSelectedSeatIds(next);
    },
    [],
  );

  const updatePendingSeatIds = useCallback(
    (update: (current: string[]) => string[]) => {
      const next = update(pendingSeatIdsRef.current);
      pendingSeatIdsRef.current = next;
      setPendingSeatIds(next);
    },
    [],
  );

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
          'La disponibilité des sièges est momentanément indisponible. La sélection est suspendue ; réessayez dans un instant.',
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
    sessionTokenRef.current = sessionToken;
  }, [sessionToken]);

  useEffect(() => {
    if (!seatMap || selectedSeatIds.length === 0) {
      return;
    }

    const heldBySessionIds = new Set(
      seatMap.seats
        .filter((seat) => seat.heldByCurrentSession)
        .map((seat) => seat.id),
    );
    const pendingIds = new Set(pendingSeatIds);
    const expiredIds = selectedSeatIds.filter(
      (seatId) => !heldBySessionIds.has(seatId) && !pendingIds.has(seatId),
    );

    if (expiredIds.length === 0) {
      return;
    }

    updateSelectedSeatIds((current) =>
      current.filter((seatId) => !expiredIds.includes(seatId)),
    );
    setTicketFares((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([seatId]) => !expiredIds.includes(seatId),
        ),
      ),
    );
    setAnnouncement(
      expiredIds.length === 1
        ? 'Le verrou d’un siège a expiré ; il a été libéré et retiré de votre sélection.'
        : 'Les verrous de plusieurs sièges ont expiré ; ils ont été libérés et retirés de votre sélection.',
    );
  }, [pendingSeatIds, seatMap, selectedSeatIds, updateSelectedSeatIds]);

  useEffect(
    () => () => {
      const pendingOperations = pendingOperationsRef.current;
      void Promise.all(pendingOperations)
        .then(async () => {
          const token = sessionTokenRef.current;
          const seatIds = selectedSeatIdsRef.current;

          if (token && seatIds.length > 0) {
            await releaseSeats(screening.id, seatIds, token, true);
          }
        })
        .catch((error) => {
          console.error(
            'Failed to release seats when closing the seat map.',
            error,
          );
        });
    },
    [screening.id],
  );

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

  async function toggleSeat(seat: SeatMapItem) {
    if (pendingSeatIdsRef.current.includes(seat.id)) {
      return;
    }

    const isSelected = selectedSeatIdsRef.current.includes(seat.id);
    const token = sessionTokenRef.current;

    if (!token) {
      return;
    }

    setActionError(null);
    setAnnouncement('');
    updatePendingSeatIds((current) => [...current, seat.id]);

    try {
      if (isSelected) {
        await releaseSeats(screening.id, [seat.id], token);
        updateSelectedSeatIds((current) =>
          current.filter((seatId) => seatId !== seat.id),
        );
        setTicketFares((current) => {
          return Object.fromEntries(
            Object.entries(current).filter(([seatId]) => seatId !== seat.id),
          );
        });
        setSeatMap((current) =>
          current
            ? {
                ...current,
                seats: current.seats.map((item) =>
                  item.id === seat.id
                    ? {
                        ...item,
                        status: 'available',
                        heldByCurrentSession: false,
                        expiresAt: null,
                      }
                    : item,
                ),
              }
            : current,
        );
        setAnnouncement('Le siège a été retiré et libéré.');
      } else if (seat.status === 'available') {
        const hold = await holdSeats(screening.id, [seat.id], token);
        updateSelectedSeatIds((current) => [...current, seat.id]);
        setTicketFares((current) => ({ ...current, [seat.id]: 'full' }));
        setSeatMap((current) =>
          current
            ? {
                ...current,
                seats: current.seats.map((item) =>
                  item.id === seat.id
                    ? {
                        ...item,
                        status: 'held',
                        heldByCurrentSession: true,
                        expiresAt: hold.expiresAt,
                      }
                    : item,
                ),
              }
            : current,
        );
        setAnnouncement(
          `Le siège est verrouillé pendant 10 minutes, jusqu’à ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(hold.expiresAt))}.`,
        );
      } else if (seat.heldByCurrentSession) {
        updateSelectedSeatIds((current) => [...current, seat.id]);
        setTicketFares((current) => ({ ...current, [seat.id]: 'full' }));
        setAnnouncement('Le siège déjà verrouillé par vous a été sélectionné.');
      }
    } catch (error) {
      if (error instanceof SeatApiError && error.status === 409) {
        setAnnouncement(
          'Ce siège vient d’être pris par un autre spectateur. Actualisation de la disponibilité en cours.',
        );
        await refreshSeatMap();
      } else {
        setActionError(
          isSelected
            ? 'Le siège n’a pas pu être libéré. Il reste dans votre sélection ; réessayez.'
            : 'Le siège n’a pas pu être verrouillé. Actualisez la disponibilité puis réessayez.',
        );
      }
    } finally {
      updatePendingSeatIds((current) =>
        current.filter((seatId) => seatId !== seat.id),
      );
    }
  }

  function handleSeatClick(seat: SeatMapItem) {
    const operation = toggleSeat(seat);
    pendingOperationsRef.current.push(operation);
    void operation.finally(() => {
      pendingOperationsRef.current = pendingOperationsRef.current.filter(
        (pending) => pending !== operation,
      );
    });
  }

  async function closeSelection() {
    const token = sessionTokenRef.current;
    const seatIds = selectedSeatIdsRef.current;

    if (token && seatIds.length > 0) {
      setIsClosing(true);
      setActionError(null);
      try {
        await releaseSeats(screening.id, seatIds, token);
        updateSelectedSeatIds(() => []);
        setTicketFares({});
      } catch {
        setActionError(
          'Les sièges n’ont pas pu être libérés. Réessayez avant de quitter le plan.',
        );
        setIsClosing(false);
        return;
      }
    }

    onClose();
  }

  const fullPriceCents = seatMap?.priceCents ?? 0;
  const reducedPriceCents = Math.round(fullPriceCents / 2);
  const totalPriceCents = selectedSeatIds.reduce(
    (total, seatId) =>
      total +
      (ticketFares[seatId] === 'reduced' ? reducedPriceCents : fullPriceCents),
    0,
  );

  return (
    <section
      aria-labelledby="seat-map-title"
      className="space-y-8"
      aria-busy={seatMap === null}
    >
      <div>
        <button
          className="mb-5 rounded-lg border border-slate-600 px-4 py-2 font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          disabled={isClosing || pendingSeatIds.length > 0}
          onClick={() => void closeSelection()}
          type="button"
        >
          {isClosing ? 'Libération des sièges…' : 'Retour à la programmation'}
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

      {actionError && (
        <p
          className="rounded-xl border border-rose-400/40 bg-rose-950/40 p-4 text-rose-100"
          role="alert"
        >
          {actionError}
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
                      const isPending = pendingSeatIds.includes(seat.id);
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
                            ? seat.heldByCurrentSession
                              ? 'border-sky-300 bg-sky-950 text-sky-100 hover:bg-sky-900'
                              : 'cursor-not-allowed border-sky-300 bg-sky-950 text-sky-100'
                            : 'border-emerald-300 bg-emerald-950 text-emerald-100 hover:bg-emerald-800';

                      return (
                        <button
                          aria-label={`Rangée ${rowNumber}, siège ${seat.seatNumber}, ${label}`}
                          aria-pressed={isSelected}
                          className={`flex h-11 min-w-11 items-center justify-center gap-1 rounded-t-xl border text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${statusClass}`}
                          disabled={
                            isPending ||
                            (!isSelected &&
                              seat.status !== 'available' &&
                              !seat.heldByCurrentSession) ||
                            (!isSelected && loadError !== null)
                          }
                          key={seat.id}
                          onClick={() => handleSeatClick(seat)}
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

          <section
            aria-label="Billets sélectionnés et tarifs"
            className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5"
          >
            <div>
              <h3 className="text-lg font-semibold text-white">
                Billets sélectionnés
              </h3>
              <p className="mt-1 text-sm text-slate-300">
                Plein tarif : {currencyFormatter.format(fullPriceCents / 100)} ·
                tarif réduit :{' '}
                {currencyFormatter.format(reducedPriceCents / 100)} (50 %)
              </p>
            </div>

            {selectedSeatIds.length === 0 ? (
              <p className="text-slate-300">Aucun siège sélectionné.</p>
            ) : (
              <ul className="space-y-3">
                {selectedSeatIds.map((seatId) => {
                  const seat = seatMap.seats.find((item) => item.id === seatId);

                  if (!seat) {
                    return null;
                  }

                  const fare = ticketFares[seatId] ?? 'full';
                  const seatLabel = `Rangée ${seat.rowNumber}, siège ${seat.seatNumber}`;

                  return (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3"
                      key={seatId}
                    >
                      <label
                        className="font-medium text-slate-100"
                        htmlFor={`ticket-fare-${seatId}`}
                      >
                        {seatLabel}
                      </label>
                      <select
                        className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                        id={`ticket-fare-${seatId}`}
                        onChange={(event) =>
                          setTicketFares((current) => ({
                            ...current,
                            [seatId]:
                              event.target.value === 'reduced'
                                ? 'reduced'
                                : 'full',
                          }))
                        }
                        value={fare}
                      >
                        <option value="full">
                          Plein tarif —{' '}
                          {currencyFormatter.format(fullPriceCents / 100)}
                        </option>
                        <option value="reduced">
                          Tarif réduit —{' '}
                          {currencyFormatter.format(reducedPriceCents / 100)}
                        </option>
                      </select>
                    </li>
                  );
                })}
              </ul>
            )}

            <p
              aria-live="polite"
              className="border-t border-slate-700 pt-4 text-lg font-semibold text-white"
            >
              Total : {currencyFormatter.format(totalPriceCents / 100)}
            </p>
            <p className="text-sm text-slate-400">
              Les sièges sont verrouillés 10 minutes dès leur sélection et
              libérés lorsqu’ils sont retirés ou lorsque vous quittez ce
              parcours.
            </p>
          </section>
        </>
      )}

      <p aria-live="assertive" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

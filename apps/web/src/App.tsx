import { useEffect, useRef, useState } from 'react';
import { getProgramme, type ProgrammeItem } from './programme-api';

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getParisDateKey(startTime: string) {
  const dateParts = dateKeyFormatter.formatToParts(new Date(startTime));
  const parts = Object.fromEntries(
    dateParts.map(({ type, value }) => [type, value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getOccupancyPresentation(status: ProgrammeItem['occupancyStatus']) {
  switch (status) {
    case 'AVAILABLE':
      return {
        label: 'Disponible',
        className: 'border-emerald-400/40 bg-emerald-950/60 text-emerald-200',
      };
    case 'LAST_SEATS':
      return {
        label: 'Dernières places',
        className: 'border-amber-300/40 bg-amber-950/60 text-amber-200',
      };
    case 'FULL':
      return {
        label: 'Complet',
        className: 'border-rose-400/40 bg-rose-950/60 text-rose-200',
      };
  }
}

export default function App() {
  const [programme, setProgramme] = useState<ProgrammeItem[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [hasRefreshError, setHasRefreshError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedScreeningId, setSelectedScreeningId] = useState<string | null>(
    null,
  );
  const [seatSelectionRequested, setSeatSelectionRequested] = useState(false);
  const [titleSearch, setTitleSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;
    let isActive = true;

    setProgramme(null);
    setHasError(false);
    setHasRefreshError(false);

    async function loadProgramme(isInitialLoad: boolean) {
      try {
        const nextProgramme = await getProgramme(controller.signal);
        if (isActive) {
          setProgramme(nextProgramme);
          setHasError(false);
          setHasRefreshError(false);
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        if (isActive) {
          if (isInitialLoad) {
            setHasError(true);
          } else {
            setHasRefreshError(true);
          }
        }
      }

      if (isActive) {
        timeoutId = setTimeout(() => {
          void loadProgramme(false);
        }, 5000);
      }
    }

    void loadProgramme(true);

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!selectedScreeningId) {
      return;
    }

    closeButtonRef.current?.focus();

    function trapPanelFocus(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedScreeningId(null);
        setSeatSelectionRequested(false);
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) {
        return;
      }

      const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (
        event.shiftKey &&
        (document.activeElement === firstElement ||
          document.activeElement === panelRef.current)
      ) {
        event.preventDefault();
        lastElement?.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    }

    document.addEventListener('keydown', trapPanelFocus);

    return () => {
      document.removeEventListener('keydown', trapPanelFocus);
      openerRef.current?.focus();
    };
  }, [selectedScreeningId]);

  const selectedScreening =
    programme?.find(({ id }) => id === selectedScreeningId) ?? null;
  const dateOptions =
    programme?.length && programme.length > 0
      ? Array.from(
          new Map(
            programme.map((screening) => [
              getParisDateKey(screening.startTime),
              new Date(screening.startTime),
            ]),
          ),
        ).sort(([firstDate], [secondDate]) =>
          firstDate.localeCompare(secondDate),
        )
      : [];
  const genreOptions =
    programme?.length && programme.length > 0
      ? Array.from(
          new Map(
            programme.map((screening) => [
              screening.genre,
              screening.genreLabel,
            ]),
          ),
        ).sort(([, firstLabel], [, secondLabel]) =>
          firstLabel.localeCompare(secondLabel, 'fr'),
        )
      : [];
  const normalizedTitleSearch = titleSearch.trim().toLocaleLowerCase('fr-FR');
  const filteredProgramme =
    programme?.filter((screening) => {
      const matchesTitle =
        normalizedTitleSearch.length < 3 ||
        screening.title
          .toLocaleLowerCase('fr-FR')
          .includes(normalizedTitleSearch);
      const matchesDate =
        selectedDate === '' ||
        getParisDateKey(screening.startTime) === selectedDate;
      const matchesGenre =
        selectedGenre === '' || screening.genre === selectedGenre;

      return matchesTitle && matchesDate && matchesGenre;
    }) ?? [];
  const hasActiveFilters =
    titleSearch.trim() !== '' || selectedDate !== '' || selectedGenre !== '';

  function resetFilters() {
    setTitleSearch('');
    setSelectedDate('');
    setSelectedGenre('');
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100 sm:px-10">
      <div
        className="mx-auto max-w-7xl space-y-10"
        inert={Boolean(selectedScreening)}
      >
        <header className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-400">
            Le Grand Cinéma
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            La programmation
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-slate-300">
            Retrouvez les séances à venir cette semaine et choisissez votre
            prochaine sortie cinéma.
          </p>
        </header>

        {programme === null && !hasError && (
          <p className="py-10 text-center text-slate-300" role="status">
            Chargement de la programmation…
          </p>
        )}

        {hasError && (
          <section
            aria-labelledby="programme-error-title"
            className="rounded-2xl border border-rose-400/40 bg-rose-950/40 p-6"
            role="alert"
          >
            <h2 className="text-xl font-semibold" id="programme-error-title">
              La programmation est momentanément indisponible.
            </h2>
            <p className="mt-2 text-slate-300">
              Vérifiez votre connexion puis réessayez.
            </p>
            <button
              className="mt-5 rounded-lg bg-rose-200 px-4 py-2 font-semibold text-rose-950 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rose-200"
              onClick={() => setReloadKey((key) => key + 1)}
              type="button"
            >
              Réessayer
            </button>
          </section>
        )}

        {hasRefreshError && !hasError && (
          <section
            className="rounded-2xl border border-amber-300/40 bg-amber-950/40 p-5"
            role="alert"
          >
            <p className="text-amber-100">
              La jauge n’a pas pu être actualisée. Les dernières données
              disponibles sont conservées.
            </p>
            <button
              className="mt-3 rounded-lg border border-amber-200 px-4 py-2 font-semibold text-amber-100 hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-200"
              onClick={() => setReloadKey((key) => key + 1)}
              type="button"
            >
              Réessayer
            </button>
          </section>
        )}

        {programme !== null && programme.length === 0 && (
          <p className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center text-slate-300">
            Aucune séance n’est programmée pour les sept prochains jours.
          </p>
        )}

        {programme !== null && programme.length > 0 && (
          <>
            <section
              aria-label="Filtres de la programmation"
              className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="space-y-2">
                <label
                  className="block text-sm font-semibold text-slate-200"
                  htmlFor="programme-title-search"
                >
                  Rechercher par titre
                </label>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                  id="programme-title-search"
                  onChange={(event) => setTitleSearch(event.target.value)}
                  placeholder="Nom du film"
                  type="search"
                  value={titleSearch}
                />
                {titleSearch.trim().length > 0 &&
                  titleSearch.trim().length < 3 && (
                    <p className="text-sm text-slate-400">
                      Saisissez au moins 3 caractères pour rechercher.
                    </p>
                  )}
              </div>
              <div className="space-y-2">
                <label
                  className="block text-sm font-semibold text-slate-200"
                  htmlFor="programme-date-filter"
                >
                  Filtrer par date
                </label>
                <select
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                  id="programme-date-filter"
                  onChange={(event) => setSelectedDate(event.target.value)}
                  value={selectedDate}
                >
                  <option value="">Toutes les dates</option>
                  {dateOptions.map(([dateKey, date]) => (
                    <option key={dateKey} value={dateKey}>
                      {dateFormatter.format(date)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label
                  className="block text-sm font-semibold text-slate-200"
                  htmlFor="programme-genre-filter"
                >
                  Filtrer par genre
                </label>
                <select
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                  id="programme-genre-filter"
                  onChange={(event) => setSelectedGenre(event.target.value)}
                  value={selectedGenre}
                >
                  <option value="">Tous les genres</option>
                  {genreOptions.map(([genre, genreLabel]) => (
                    <option key={genre} value={genre}>
                      {genreLabel}
                    </option>
                  ))}
                </select>
              </div>
              {hasActiveFilters && filteredProgramme.length > 0 && (
                <div className="flex items-end">
                  <button
                    className="rounded-lg border border-slate-600 px-4 py-2 font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                    onClick={resetFilters}
                    type="button"
                  >
                    Réinitialiser les filtres
                  </button>
                </div>
              )}
            </section>

            {filteredProgramme.length === 0 ? (
              <section
                aria-live="polite"
                className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center"
                role="status"
              >
                <p className="text-slate-300">
                  Aucune séance ne correspond à vos critères.
                </p>
                <button
                  className="mt-4 rounded-lg bg-amber-300 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                  onClick={resetFilters}
                  type="button"
                >
                  Réinitialiser les filtres
                </button>
              </section>
            ) : (
              <section aria-label="Séances des sept prochains jours">
                <ul className="grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredProgramme.map((screening) => (
                    <li key={screening.id}>
                      <article className="relative h-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl shadow-black/20">
                        <button
                          aria-label={`Voir les détails de la séance ${screening.title}, ${dateTimeFormatter.format(new Date(screening.startTime))}`}
                          className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-4 focus-visible:outline-offset-[-4px] focus-visible:outline-amber-300"
                          onClick={(event) => {
                            openerRef.current = event.currentTarget;
                            setSeatSelectionRequested(false);
                            setSelectedScreeningId(screening.id);
                          }}
                          type="button"
                        />
                        <div className="aspect-[2/3] max-h-[28rem] overflow-hidden bg-slate-800">
                          {screening.posterUrl ? (
                            <img
                              alt={`Affiche du film ${screening.title}`}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              src={screening.posterUrl}
                            />
                          ) : (
                            <div
                              aria-label={`Affiche indisponible pour ${screening.title}`}
                              className="flex h-full items-center justify-center p-8 text-center text-slate-400"
                              role="img"
                            >
                              Affiche indisponible
                            </div>
                          )}
                        </div>
                        <div className="pointer-events-none space-y-4 p-5">
                          <div>
                            <p className="text-sm font-semibold text-amber-300">
                              {screening.genreLabel}
                              <span aria-hidden="true"> · </span>
                              {screening.duration} min
                            </p>
                            <h2 className="mt-2 text-2xl font-bold leading-tight">
                              {screening.title}
                            </h2>
                          </div>
                          <p
                            className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${getOccupancyPresentation(screening.occupancyStatus).className}`}
                          >
                            {
                              getOccupancyPresentation(
                                screening.occupancyStatus,
                              ).label
                            }
                          </p>
                          <dl className="space-y-2 border-t border-slate-700 pt-4 text-slate-300">
                            <div>
                              <dt className="sr-only">Séance</dt>
                              <dd className="font-medium text-white">
                                {dateTimeFormatter.format(
                                  new Date(screening.startTime),
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="sr-only">Salle</dt>
                              <dd>{screening.roomName}</dd>
                            </div>
                          </dl>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      {selectedScreening && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedScreeningId(null);
              setSeatSelectionRequested(false);
            }
          }}
        >
          <section
            aria-labelledby="screening-panel-title"
            aria-modal="true"
            className="h-full w-full overflow-y-auto border-l border-slate-700 bg-slate-900 p-6 shadow-2xl sm:max-w-xl sm:p-8"
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">
                  Détails de la séance
                </p>
                <h2
                  className="mt-2 text-3xl font-bold"
                  id="screening-panel-title"
                >
                  {selectedScreening.title}
                </h2>
              </div>
              <button
                aria-label="Fermer les détails de la séance"
                className="shrink-0 rounded-lg border border-slate-600 px-3 py-2 font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                onClick={() => {
                  setSelectedScreeningId(null);
                  setSeatSelectionRequested(false);
                }}
                ref={closeButtonRef}
                type="button"
              >
                Fermer
              </button>
            </div>
            <div className="mt-6 aspect-[2/3] max-h-[28rem] overflow-hidden rounded-xl bg-slate-800">
              {selectedScreening.posterUrl ? (
                <img
                  alt={`Affiche du film ${selectedScreening.title}`}
                  className="h-full w-full object-cover"
                  src={selectedScreening.posterUrl}
                />
              ) : (
                <div
                  aria-label={`Affiche indisponible pour ${selectedScreening.title}`}
                  className="flex h-full items-center justify-center p-8 text-center text-slate-400"
                  role="img"
                >
                  Affiche indisponible
                </div>
              )}
            </div>
            <p className="mt-5 text-amber-300">
              {selectedScreening.genreLabel}
              <span aria-hidden="true"> · </span>
              {selectedScreening.duration} min
            </p>
            <dl className="mt-4 space-y-3 border-t border-slate-700 pt-4 text-slate-300">
              <div>
                <dt className="font-semibold text-white">Séance</dt>
                <dd>
                  {dateTimeFormatter.format(
                    new Date(selectedScreening.startTime),
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Salle</dt>
                <dd>{selectedScreening.roomName}</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Remplissage</dt>
                <dd
                  className={`mt-1 inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${getOccupancyPresentation(selectedScreening.occupancyStatus).className}`}
                  role="status"
                >
                  {
                    getOccupancyPresentation(selectedScreening.occupancyStatus)
                      .label
                  }
                </dd>
              </div>
            </dl>
            {selectedScreening.occupancyStatus !== 'FULL' && (
              <div className="mt-8">
                <button
                  className="w-full rounded-lg bg-amber-300 px-5 py-3 font-bold text-slate-950 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
                  onClick={() => setSeatSelectionRequested(true)}
                  type="button"
                >
                  Choisir mes places
                </button>
                {seatSelectionRequested && (
                  <p className="mt-3 text-sm text-slate-300" role="status">
                    Le choix des places sera disponible dans l’étape suivante de
                    la réservation.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

import { useEffect, useState } from 'react';
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

export default function App() {
  const [programme, setProgramme] = useState<ProgrammeItem[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [titleSearch, setTitleSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    setProgramme(null);
    setHasError(false);

    getProgramme(controller.signal)
      .then(setProgramme)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        setHasError(true);
      });

    return () => controller.abort();
  }, [reloadKey]);

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
      <div className="mx-auto max-w-7xl space-y-10">
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
                      <article className="h-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl shadow-black/20">
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
                        <div className="space-y-4 p-5">
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
    </main>
  );
}

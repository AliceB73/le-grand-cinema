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

export default function App() {
  const [programme, setProgramme] = useState<ProgrammeItem[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
          <section aria-label="Séances des sept prochains jours">
            <ul className="grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {programme.map((screening) => (
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
      </div>
    </main>
  );
}

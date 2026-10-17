import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  GENRES,
  createMovie,
  deleteMovie,
  describeAdminError,
  listMovies,
  updateMovie,
  type AdminMovie,
} from './admin-api';
import {
  authFieldClassName,
  authPrimaryButtonClassName,
} from './auth-form-styles';

const secondaryButton =
  'rounded-lg border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300';

export default function AdminMoviesPage() {
  const [movies, setMovies] = useState<AdminMovie[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState<string>(GENRES[0][0]);
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reload = useCallback(async () => {
    try {
      setMovies(await listMovies());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setGenre(GENRES[0][0]);
    setDescription('');
    setDuration('');
    setPosterUrl('');
  }

  function startEdit(movie: AdminMovie) {
    setEditingId(movie.id);
    setTitle(movie.title);
    setGenre(movie.genre);
    setDescription(movie.description);
    setDuration(String(movie.duration));
    setPosterUrl(movie.posterUrl ?? '');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const minutes = Number(duration);
    if (
      !title.trim() ||
      !description.trim() ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > 600
    ) {
      setFeedback({
        text: 'Renseignez un titre, une description et une durée en minutes (1 à 600).',
        isError: true,
      });
      return;
    }
    const input = {
      title: title.trim(),
      genre,
      description: description.trim(),
      duration: minutes,
      posterUrl: posterUrl.trim() || null,
    };
    setIsSubmitting(true);
    try {
      if (editingId) {
        await updateMovie(editingId, input);
      } else {
        await createMovie(input);
      }
      setFeedback({
        text: editingId ? 'Film mis à jour.' : 'Film créé.',
        isError: false,
      });
      resetForm();
      await reload();
    } catch (error) {
      setFeedback({ text: describeAdminError(error), isError: true });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function remove(movie: AdminMovie) {
    if (!window.confirm(`Supprimer le film « ${movie.title} » ?`)) {
      return;
    }
    try {
      await deleteMovie(movie.id);
      setFeedback({ text: 'Film supprimé.', isError: false });
      await reload();
    } catch (error) {
      setFeedback({ text: describeAdminError(error), isError: true });
    }
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="movie-form" className="space-y-4">
        <h2 className="text-xl font-semibold" id="movie-form">
          {editingId ? 'Modifier le film' : 'Ajouter un film'}
        </h2>
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <label className="block text-sm font-semibold">
            Titre
            <input
              className={authFieldClassName}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          <label className="block text-sm font-semibold">
            Genre
            <select
              className={authFieldClassName}
              onChange={(event) => setGenre(event.target.value)}
              value={genre}
            >
              {GENRES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold sm:col-span-2">
            Description
            <textarea
              className={authFieldClassName}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              required
              rows={3}
              value={description}
            />
          </label>
          <label className="block text-sm font-semibold">
            Durée (minutes)
            <input
              className={authFieldClassName}
              inputMode="numeric"
              onChange={(event) => setDuration(event.target.value)}
              required
              value={duration}
            />
          </label>
          <label className="block text-sm font-semibold">
            Affiche (URL ou chemin, facultatif)
            <input
              className={authFieldClassName}
              maxLength={500}
              onChange={(event) => setPosterUrl(event.target.value)}
              value={posterUrl}
            />
          </label>
          <div className="flex gap-3 sm:col-span-2">
            <button
              className={authPrimaryButtonClassName}
              disabled={isSubmitting}
              type="submit"
            >
              {editingId ? 'Enregistrer le film' : 'Créer le film'}
            </button>
            {editingId && (
              <button
                className={secondaryButton}
                onClick={resetForm}
                type="button"
              >
                Annuler la modification
              </button>
            )}
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

      <section aria-labelledby="movie-list" className="space-y-4">
        <h2 className="text-xl font-semibold" id="movie-list">
          Films
        </h2>
        {loadError ? (
          <p className="text-rose-200" role="alert">
            Impossible de charger les films.
          </p>
        ) : movies === null ? (
          <p className="text-slate-300" role="status">
            Chargement des films…
          </p>
        ) : movies.length === 0 ? (
          <p className="text-slate-300">Aucun film.</p>
        ) : (
          <ul className="space-y-3">
            {movies.map((movie) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4"
                key={movie.id}
              >
                <div>
                  <p className="font-semibold">{movie.title}</p>
                  <p className="text-sm text-slate-400">
                    {movie.genre} · {movie.duration} min
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className={secondaryButton}
                    onClick={() => startEdit(movie)}
                    type="button"
                  >
                    Modifier
                    <span className="sr-only"> {movie.title}</span>
                  </button>
                  <button
                    className={secondaryButton}
                    onClick={() => void remove(movie)}
                    type="button"
                  >
                    Supprimer
                    <span className="sr-only"> {movie.title}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

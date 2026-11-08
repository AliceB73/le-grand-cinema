export const PROGRAMME_CACHE_TTL_MS = 10_000;

// Évite une requête base de données par appel : les requêtes concurrentes
// partagent le même chargement et les erreurs ne sont jamais mises en cache.
export function createProgrammeCache<T>(
  load: () => Promise<T>,
  ttlMs: number = PROGRAMME_CACHE_TTL_MS,
  now: () => number = Date.now,
): () => Promise<T> {
  let value: { data: T; expiresAt: number } | undefined;
  let inFlight: Promise<T> | undefined;

  return () => {
    if (value && now() < value.expiresAt) {
      return Promise.resolve(value.data);
    }
    if (inFlight) {
      return inFlight;
    }

    const pending = load()
      .then((data) => {
        value = { data, expiresAt: now() + ttlMs };
        return data;
      })
      .finally(() => {
        inFlight = undefined;
      });
    inFlight = pending;
    return pending;
  };
}

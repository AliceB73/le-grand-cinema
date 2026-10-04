export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto max-w-3xl space-y-5">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-400">
          Le Grand Cinéma
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Votre prochaine séance commence ici.
        </h1>
        <p className="max-w-xl text-lg leading-8 text-slate-300">
          L’application de réservation est initialisée. Les séances et la
          réservation de billets seront ajoutées dans les prochaines étapes.
        </p>
        <a
          className="inline-flex rounded-lg bg-amber-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          href="http://localhost:3000/api/docs"
        >
          Consulter la documentation API
        </a>
      </section>
    </main>
  );
}

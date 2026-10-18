import { useEffect, useState } from 'react';

const CONSENT_STORAGE_KEY = 'le-grand-cinema-privacy-consent';

type ConsentChoice = 'accepted' | 'rejected';

export default function PrivacyConsentBanner() {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const storedChoice = window.localStorage.getItem(CONSENT_STORAGE_KEY);
      if (storedChoice === 'accepted' || storedChoice === 'rejected') {
        setChoice(storedChoice);
      } else {
        setIsOpen(true);
      }
    } catch {
      setErrorMessage(
        'Votre préférence de confidentialité ne peut pas être lue dans ce navigateur.',
      );
      setIsOpen(true);
    }
  }, []);

  function saveChoice(nextChoice: ConsentChoice) {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, nextChoice);
      setChoice(nextChoice);
      setErrorMessage(null);
      setIsOpen(false);
    } catch {
      setErrorMessage(
        'Votre choix n’a pas pu être enregistré. Autorisez le stockage local puis réessayez.',
      );
    }
  }

  return (
    <>
      {isOpen ? (
        <section
          aria-labelledby="privacy-consent-title"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6"
          role="region"
        >
          <div className="mx-auto max-w-5xl space-y-4">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold" id="privacy-consent-title">
                Vos choix de confidentialité
              </h2>
              <p className="text-sm text-slate-300">
                Le site n’utilise actuellement aucun traceur analytique ou
                publicitaire. Votre choix est mémorisé sur cet appareil ; aucun
                traceur facultatif n’est chargé sans votre accord.
              </p>
            </div>
            {errorMessage && (
              <p className="text-sm text-rose-200" role="alert">
                {errorMessage}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
                onClick={() => saveChoice('rejected')}
                type="button"
              >
                Tout refuser
              </button>
              <button
                className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
                onClick={() => saveChoice('accepted')}
                type="button"
              >
                Tout accepter
              </button>
            </div>
          </div>
        </section>
      ) : (
        <button
          aria-label="Gérer les préférences de confidentialité"
          className="fixed bottom-4 right-4 z-30 rounded-full border border-slate-600 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-200 shadow-lg hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          onClick={() => setIsOpen(true)}
          type="button"
        >
          Confidentialité
        </button>
      )}
      {!isOpen && errorMessage && (
        <p className="fixed bottom-16 right-4 z-30 rounded bg-slate-900 p-3 text-sm text-rose-200">
          {errorMessage}
        </p>
      )}
      {choice && !isOpen && (
        <span className="sr-only" role="status">
          Préférence de confidentialité enregistrée.
        </span>
      )}
    </>
  );
}

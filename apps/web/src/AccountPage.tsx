import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthSession } from './AuthSessionProvider';
import {
  CustomerApiError,
  getMyBookings,
  getMyTicket,
  type CustomerBooking,
} from './my-bookings-api';
import { supabase } from './supabase-client';

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const LOAD_ERROR_MESSAGE =
  'Vos réservations sont momentanément indisponibles. Réessayez dans quelques instants.';
const FORBIDDEN_MESSAGE =
  'L’espace client est réservé aux comptes spectateurs.';
const TICKET_ERROR_MESSAGE =
  'Votre billet est momentanément indisponible. Réessayez dans quelques instants.';

async function getAccessToken() {
  const { data } = (await supabase?.auth.getSession()) ?? {
    data: { session: null },
  };
  return data.session?.access_token ?? null;
}

function formatSeats(seats: CustomerBooking['seats']) {
  return seats
    .map(({ rowNumber, seatNumber }) => `${rowNumber}${seatNumber}`)
    .join(', ');
}

function BookingCard({ booking }: { booking: CustomerBooking }) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function toggleTicket() {
    if (qrCode) {
      setQrCode(null);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('NO_SESSION');
      }
      setQrCode((await getMyTicket(booking.id, accessToken)).qrCodeDataUrl);
    } catch {
      setErrorMessage(TICKET_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <li className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold">{booking.movieTitle}</h3>
        {booking.used && (
          <span className="rounded-full border border-slate-500 px-3 py-1 text-xs font-semibold text-slate-300">
            Utilisé
          </span>
        )}
      </div>
      <p className="text-slate-300">
        {dateTimeFormatter.format(new Date(booking.startTime))} ·{' '}
        {booking.roomName}
      </p>
      <p className="text-sm text-slate-400">
        {booking.seatCount} {booking.seatCount > 1 ? 'places' : 'place'} :{' '}
        {formatSeats(booking.seats)}
      </p>
      <button
        aria-expanded={qrCode !== null}
        className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 disabled:opacity-60"
        disabled={isLoading}
        onClick={() => void toggleTicket()}
        type="button"
      >
        {qrCode ? 'Masquer le billet' : 'Afficher le billet'}
        <span className="sr-only"> pour {booking.movieTitle}</span>
      </button>
      {errorMessage && (
        <p className="text-sm text-rose-200" role="alert">
          {errorMessage}
        </p>
      )}
      {qrCode && (
        <div className="space-y-2">
          <img
            alt={`QR code du billet pour ${booking.movieTitle}`}
            className="h-60 w-60 rounded-lg bg-white p-2"
            src={qrCode}
          />
          <p className="text-sm text-slate-400">
            Ce QR code est valable pour l’ensemble du groupe et ne peut être
            utilisé qu’une seule fois.
          </p>
        </div>
      )}
    </li>
  );
}

function BookingSection({
  bookings,
  title,
}: {
  bookings: CustomerBooking[];
  title: string;
}) {
  return (
    <section aria-labelledby={`section-${title}`} className="space-y-4">
      <h2 className="text-xl font-semibold" id={`section-${title}`}>
        {title}
      </h2>
      {bookings.length === 0 ? (
        <p className="text-slate-400">Aucune réservation.</p>
      ) : (
        <ul className="space-y-4">
          {bookings.map((booking) => (
            <BookingCard booking={booking} key={booking.id} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AccountPage() {
  const { email, isReady } = useAuthSession();
  const [bookings, setBookings] = useState<CustomerBooking[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!email) {
      return;
    }
    let isMounted = true;

    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error('NO_SESSION');
        }
        const result = await getMyBookings(accessToken);
        if (isMounted) {
          setBookings(result);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof CustomerApiError && error.status === 403
              ? FORBIDDEN_MESSAGE
              : LOAD_ERROR_MESSAGE,
          );
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [email]);

  if (!isReady) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
        <p className="text-slate-300" role="status">
          Chargement de votre espace…
        </p>
      </main>
    );
  }

  if (!email) {
    return <Navigate replace to="/connexion" />;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12 sm:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Mes billets</h1>
      {errorMessage ? (
        <p className="text-rose-200" role="alert">
          {errorMessage}
        </p>
      ) : bookings === null ? (
        <p className="text-slate-300" role="status">
          Chargement de vos réservations…
        </p>
      ) : bookings.length === 0 ? (
        <p className="text-slate-300">
          Vous n’avez pas encore de réservation confirmée avec l’adresse {email}
          .
        </p>
      ) : (
        <>
          <BookingSection
            bookings={bookings.filter(({ isUpcoming }) => isUpcoming)}
            title="À venir"
          />
          <BookingSection
            bookings={bookings.filter(({ isUpcoming }) => !isUpcoming)}
            title="Passées"
          />
        </>
      )}
    </main>
  );
}

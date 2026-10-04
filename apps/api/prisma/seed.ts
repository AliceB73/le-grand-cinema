import { Genre, PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();
const timeZone = 'Europe/Paris';

const movies = [
  {
    id: 'demo-movie-veilleurs-du-phare',
    title: 'Les Veilleurs du Phare',
    genre: Genre.THRILLER,
    description:
      'Sur une île balayée par les vents, une restauratrice découvre un mystérieux journal dans un vieux phare.',
    duration: 108,
    posterUrl: '/posters/veilleurs-du-phare.svg',
    showtimes: [
      { id: 'demo-showtime-veilleurs-1', day: 1, hour: 14, minute: 0 },
      { id: 'demo-showtime-veilleurs-2', day: 4, hour: 19, minute: 30 },
    ],
  },
  {
    id: 'demo-movie-jardin-des-etoiles',
    title: 'Le Jardin des étoiles',
    genre: Genre.FANTASTIQUE,
    description:
      'Deux enfants transforment un jardin oublié en observatoire tourné vers des mondes imaginaires.',
    duration: 96,
    posterUrl: '/posters/jardin-des-etoiles.svg',
    showtimes: [
      { id: 'demo-showtime-jardin-1', day: 2, hour: 16, minute: 0 },
      { id: 'demo-showtime-jardin-2', day: 5, hour: 20, minute: 0 },
    ],
  },
  {
    id: 'demo-movie-dernier-tram',
    title: 'Le Dernier Tram',
    genre: Genre.COMEDIE,
    description:
      'Le temps d’un trajet nocturne, des inconnus partagent leurs petits et grands projets.',
    duration: 101,
    posterUrl: '/posters/dernier-tram.svg',
    showtimes: [
      { id: 'demo-showtime-tram-1', day: 3, hour: 14, minute: 30 },
      { id: 'demo-showtime-tram-2', day: 6, hour: 18, minute: 0 },
    ],
  },
] as const;

async function seed() {
  for (const movie of movies) {
    await prisma.movie.upsert({
      where: { id: movie.id },
      create: {
        id: movie.id,
        title: movie.title,
        genre: movie.genre,
        description: movie.description,
        duration: movie.duration,
        posterUrl: movie.posterUrl,
      },
      update: {
        title: movie.title,
        genre: movie.genre,
        description: movie.description,
        duration: movie.duration,
        posterUrl: movie.posterUrl,
      },
    });

    for (const screening of movie.showtimes) {
      const startTime = DateTime.now()
        .setZone(timeZone)
        .plus({ days: screening.day })
        .set({
          hour: screening.hour,
          minute: screening.minute,
          second: 0,
          millisecond: 0,
        })
        .toUTC()
        .toJSDate();

      await prisma.showtime.upsert({
        where: { id: screening.id },
        create: {
          id: screening.id,
          movieId: movie.id,
          roomName: `Salle ${String.fromCharCode(65 + (screening.day % 3))}`,
          startTime,
          price: 9.5,
        },
        update: {
          movieId: movie.id,
          roomName: `Salle ${String.fromCharCode(65 + (screening.day % 3))}`,
          startTime,
          price: 9.5,
        },
      });
    }
  }

  console.info(`Seeded ${movies.length} demo movies and 6 future screenings.`);
}

seed()
  .catch((error: unknown) => {
    console.error('Failed to seed the local cinema programme.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

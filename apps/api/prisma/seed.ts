import { Genre, PrismaClient } from '@prisma/client';
import { generateDemoShowtimes } from '../src/programme/demo-schedule.js';

const prisma = new PrismaClient();

const rooms = [
  { name: 'Salle A', category: 'PREMIUM_IMAX', capacity: 300 },
  { name: 'Salle B', category: 'PREMIUM_IMAX', capacity: 300 },
  { name: 'Salle C', category: 'STANDARD', capacity: 180 },
  { name: 'Salle D', category: 'STANDARD', capacity: 180 },
  { name: 'Salle E', category: 'STANDARD', capacity: 180 },
  { name: 'Salle F', category: 'STANDARD', capacity: 180 },
  { name: 'Salle G', category: 'VIP', capacity: 120 },
  { name: 'Salle H', category: 'VIP', capacity: 120 },
  { name: 'Salle I', category: 'EVENT', capacity: 70 },
  { name: 'Salle J', category: 'EVENT', capacity: 70 },
] as const;

const movies = [
  {
    id: 'demo-movie-veilleurs-du-phare',
    title: 'Les Veilleurs du Phare',
    genre: Genre.THRILLER,
    description:
      'Sur une île balayée par les vents, une restauratrice découvre un mystérieux journal dans un vieux phare.',
    duration: 108,
    posterUrl: '/posters/veilleurs-du-phare.svg',
    scheduleKey: 'veilleurs-du-phare',
    roomName: 'Salle A',
    firstWeekIds: ['demo-showtime-veilleurs-1', 'demo-showtime-veilleurs-2'],
  },
  {
    id: 'demo-movie-jardin-des-etoiles',
    title: 'Le Jardin des étoiles',
    genre: Genre.FANTASTIQUE,
    description:
      'Deux enfants transforment un jardin oublié en observatoire tourné vers des mondes imaginaires.',
    duration: 96,
    posterUrl: '/posters/jardin-des-etoiles.svg',
    scheduleKey: 'jardin-des-etoiles',
    roomName: 'Salle B',
    firstWeekIds: ['demo-showtime-jardin-1', 'demo-showtime-jardin-2'],
  },
  {
    id: 'demo-movie-dernier-tram',
    title: 'Le Dernier Tram',
    genre: Genre.COMEDIE,
    description:
      'Le temps d’un trajet nocturne, des inconnus partagent leurs petits et grands projets.',
    duration: 101,
    posterUrl: '/posters/dernier-tram.svg',
    scheduleKey: 'dernier-tram',
    roomName: 'Salle C',
    firstWeekIds: ['demo-showtime-tram-1', 'demo-showtime-tram-2'],
  },
] as const;

async function seed() {
  let totalShowtimes = 0;

  for (const room of rooms) {
    await prisma.room.upsert({
      where: { name: room.name },
      create: room,
      update: room,
    });
  }

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

    const showtimes = generateDemoShowtimes(
      movie.scheduleKey,
      movie.firstWeekIds,
    );
    for (const screening of showtimes) {
      await prisma.showtime.upsert({
        where: { id: screening.id },
        create: {
          id: screening.id,
          movieId: movie.id,
          roomId: movie.roomName,
          startTime: screening.startTime,
          price: 9.5,
        },
        update: {
          movieId: movie.id,
          roomId: movie.roomName,
          startTime: screening.startTime,
          price: 9.5,
        },
      });
    }

    totalShowtimes += showtimes.length;
  }

  console.info(
    `Seeded ${movies.length} demo movies and ${totalShowtimes} screenings from October 12 through December 31, 2026.`,
  );
}

seed()
  .catch((error: unknown) => {
    console.error('Failed to seed the local cinema programme.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

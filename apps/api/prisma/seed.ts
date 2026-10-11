import { Genre, PrismaClient, RoomCategory } from '@prisma/client';
import { generateDemoShowtimes } from '../src/programme/demo-schedule.js';

const prisma = new PrismaClient();

const roomTypes = [
  ...['Salle A', 'Salle B'].map((name) => ({
    name,
    category: RoomCategory.PREMIUM_IMAX,
    capacity: 300,
    seatsPerRow: 20,
  })),
  ...['Salle C', 'Salle D', 'Salle E', 'Salle F'].map((name) => ({
    name,
    category: RoomCategory.STANDARD,
    capacity: 180,
    seatsPerRow: 15,
  })),
  ...['Salle G', 'Salle H'].map((name) => ({
    name,
    category: RoomCategory.VIP,
    capacity: 120,
    seatsPerRow: 12,
  })),
  ...['Salle I', 'Salle J'].map((name) => ({
    name,
    category: RoomCategory.EVENT,
    capacity: 70,
    seatsPerRow: 10,
  })),
];

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

  for (const room of roomTypes) {
    await prisma.room.upsert({
      where: { name: room.name },
      create: {
        name: room.name,
        category: room.category,
        capacity: room.capacity,
      },
      update: {
        category: room.category,
        capacity: room.capacity,
      },
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
    const layout = roomTypes.find(({ name }) => name === movie.roomName);
    if (!layout) {
      throw new Error(`Unknown demo room: ${movie.roomName}`);
    }

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

      const seats = Array.from({ length: layout.capacity }, (_, index) => ({
        showtimeId: screening.id,
        rowNumber: String.fromCharCode(
          'A'.charCodeAt(0) + Math.floor(index / layout.seatsPerRow),
        ),
        seatNumber: (index % layout.seatsPerRow) + 1,
      }));

      await prisma.seat.createMany({
        data: seats,
        skipDuplicates: true,
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

import { Genre } from '@prisma/client';

export const genreLabels: Record<Genre, string> = {
  [Genre.ACTION]: 'Action',
  [Genre.ANIMATION]: 'Animation',
  [Genre.AVENTURE]: 'Aventure',
  [Genre.COMEDIE]: 'Comédie',
  [Genre.DOCUMENTAIRE]: 'Documentaire',
  [Genre.DRAME]: 'Drame',
  [Genre.FANTASTIQUE]: 'Fantastique',
  [Genre.HORREUR]: 'Horreur',
  [Genre.ROMANCE]: 'Romance',
  [Genre.SCIENCE_FICTION]: 'Science-fiction',
  [Genre.THRILLER]: 'Thriller',
};

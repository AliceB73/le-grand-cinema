/*
  Warnings:

  - Added the required column `genre` to the `Movie` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Genre" AS ENUM ('ACTION', 'ANIMATION', 'AVENTURE', 'COMEDIE', 'DOCUMENTAIRE', 'DRAME', 'FANTASTIQUE', 'HORREUR', 'ROMANCE', 'SCIENCE_FICTION', 'THRILLER');

-- AlterTable
ALTER TABLE "Movie" ADD COLUMN     "genre" "Genre" NOT NULL;

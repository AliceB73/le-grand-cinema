import { expect, test } from '@playwright/test';

test('home page displays upcoming cinema screenings', async ({ page }) => {
  await page.route('**/api/programme', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'demo-showtime-veilleurs-1',
          title: 'Les Veilleurs du Phare',
          genre: 'THRILLER',
          genreLabel: 'Thriller',
          duration: 108,
          posterUrl: '/posters/veilleurs-du-phare.svg',
          roomName: 'Salle B',
          occupancyStatus: 'AVAILABLE',
          startTime: '2026-10-05T12:00:00.000Z',
        },
      ]),
    });
  });

  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'La programmation', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Les Veilleurs du Phare' }),
  ).toBeVisible();
  await expect(page.getByText('Salle B')).toBeVisible();
});

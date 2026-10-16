import { expect, test } from '@playwright/test';

test('home page displays upcoming cinema screenings', async ({ page }) => {
  let held = false;

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
  await page.route('**/api/showtimes/*/seats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        showtimeId: 'demo-showtime-veilleurs-1',
        priceCents: 950,
        seats: [
          {
            id: 'seat-a1',
            rowNumber: 'A',
            seatNumber: 1,
            status: held ? 'held' : 'available',
            heldByCurrentSession: held,
            expiresAt: held ? '2026-10-05T12:10:00.000Z' : null,
          },
        ],
      }),
    });
  });
  await page.route('**/api/showtimes/*/seats/holds', async (route) => {
    if (route.request().method() === 'POST') {
      held = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          heldSeatIds: ['seat-a1'],
          expiresAt: '2026-10-05T12:10:00.000Z',
        }),
      });
      return;
    }

    held = false;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ released: true }),
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
  await expect(page.getByText('Disponible')).toBeVisible();

  await page
    .getByRole('button', { name: /Voir les détails de la séance/ })
    .click();

  const detailsPanel = page.getByRole('dialog');
  await expect(detailsPanel.getByText('Détails de la séance')).toBeVisible();
  await expect(
    detailsPanel.getByRole('heading', { name: 'Les Veilleurs du Phare' }),
  ).toBeVisible();
  await expect(detailsPanel.getByRole('status')).toHaveText('Disponible');
  await expect(
    detailsPanel.getByRole('button', { name: 'Choisir mes places' }),
  ).toBeVisible();

  await detailsPanel
    .getByRole('button', { name: 'Choisir mes places' })
    .click();
  await page.getByRole('button', { name: 'Rangée A, siège 1, libre' }).click();
  await expect(
    page.getByRole('button', { name: 'Rangée A, siège 1, sélectionné' }),
  ).toBeVisible();
  await page
    .getByLabel('Rangée A, siège 1', { exact: true })
    .selectOption('reduced');
  await expect(page.getByText(/Total : 4,75/)).toBeVisible();
  await page.getByRole('button', { name: 'Retour à la programmation' }).click();
  await expect.poll(() => held).toBe(false);
});

test('starts hosted Stripe Checkout with the selected ticket fare', async ({
  page,
}) => {
  let checkoutPayload: unknown;
  let checkoutSessionToken: string | undefined;

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
          posterUrl: null,
          roomName: 'Salle A',
          occupancyStatus: 'AVAILABLE',
          startTime: '2026-10-05T12:00:00.000Z',
        },
      ]),
    });
  });
  await page.route('**/api/showtimes/*/seats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        showtimeId: 'demo-showtime-veilleurs-1',
        priceCents: 950,
        seats: [
          {
            id: 'seat-a1',
            rowNumber: 'A',
            seatNumber: 1,
            status: 'available',
            heldByCurrentSession: false,
            expiresAt: null,
          },
        ],
      }),
    });
  });
  await page.route('**/api/showtimes/*/seats/holds', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        heldSeatIds: ['seat-a1'],
        expiresAt: '2026-10-05T12:10:00.000Z',
      }),
    });
  });
  await page.route('**/api/showtimes/*/checkout', async (route) => {
    checkoutPayload = route.request().postDataJSON();
    checkoutSessionToken = route.request().headers()['x-seat-session-token'];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'cs_test_checkout-1',
        url: 'https://checkout.stripe.com/pay/test',
      }),
    });
  });
  await page.route('https://checkout.stripe.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<h1>Stripe Checkout test</h1>',
    });
  });

  await page.goto('/');
  await page
    .getByRole('button', { name: /Voir les détails de la séance/ })
    .click();
  await page.getByRole('button', { name: 'Choisir mes places' }).click();
  await page.getByRole('button', { name: 'Rangée A, siège 1, libre' }).click();
  await page
    .getByLabel('Rangée A, siège 1', { exact: true })
    .selectOption('reduced');
  await page.getByRole('button', { name: 'Payer par carte' }).click();

  await expect(
    page.getByRole('heading', { name: 'Stripe Checkout test' }),
  ).toBeVisible();
  expect(checkoutPayload).toEqual({
    tickets: [{ seatId: 'seat-a1', fare: 'reduced' }],
  });
  expect(checkoutSessionToken).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});

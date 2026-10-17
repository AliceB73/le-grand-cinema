import { expect, test } from '@playwright/test';

const spectator = {
  email: 'alice@example.com',
  password: 'motdepasse12',
};

function json(route: { fulfill: (response: object) => Promise<void> }, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/programme', async (route) => {
    await json(route, []);
  });
});

test('rejects a weak password on the sign-up form', async ({ page }) => {
  await page.goto('/inscription');

  await expect(
    page.getByText('Le mot de passe doit contenir au moins 12 caractères.'),
  ).toBeVisible();

  await page.getByLabel('Adresse e-mail').fill(spectator.email);
  await page.getByLabel('Mot de passe').fill('tropcourt');
  await page.getByRole('button', { name: 'S’inscrire' }).click();

  await expect(page).toHaveURL(/\/inscription$/);
  await expect(page.getByLabel('Mot de passe')).toHaveJSProperty(
    'validity.tooShort',
    true,
  );
});

test('creates an account then signs in from the header', async ({ page }) => {
  await page.route('**/auth/v1/signup', async (route) => {
    await json(route, {
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token',
      user: { id: 'user-1', email: spectator.email },
    });
  });
  await page.route('**/auth/v1/token**', async (route) => {
    await json(route, {
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token',
      user: { id: 'user-1', email: spectator.email },
    });
  });
  await page.route('**/auth/v1/user**', async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, { id: 'user-1', email: spectator.email });
      return;
    }
    await route.continue();
  });
  await page.route('**/auth/v1/logout**', async (route) => {
    await json(route, {});
  });

  await page.goto('/inscription');
  await page.getByLabel('Adresse e-mail').fill(spectator.email);
  await page.getByLabel('Mot de passe').fill(spectator.password);
  await page.getByRole('button', { name: 'S’inscrire' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByText(spectator.email)).toBeVisible();

  await page.getByRole('button', { name: 'Déconnexion' }).click();
  await expect(page.getByRole('link', { name: 'Connexion' })).toBeVisible();

  await page.getByRole('link', { name: 'Connexion' }).click();
  await page.getByLabel('Adresse e-mail').fill(spectator.email);
  await page.getByLabel('Mot de passe').fill(spectator.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByText(spectator.email)).toBeVisible();
});

test('requests a password reset email', async ({ page }) => {
  await page.route('**/auth/v1/recover**', async (route) => {
    await json(route, {});
  });

  await page.goto('/mot-de-passe-oublie');
  await page.getByLabel('Adresse e-mail').fill(spectator.email);
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();

  await expect(
    page.getByText(
      'Si un compte existe pour cette adresse, un courriel avec un lien valable une heure vient d’être envoyé.',
    ),
  ).toBeVisible();
});

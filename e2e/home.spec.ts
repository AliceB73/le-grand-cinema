import { expect, test } from '@playwright/test';

test('home page provides a link to the API documentation', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Votre prochaine séance commence ici.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Consulter la documentation API' }),
  ).toHaveAttribute('href', 'http://localhost:3000/api/docs');
});

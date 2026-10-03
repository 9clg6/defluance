import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import { openInEnglish, TOKEN } from './support.ts';

test('visitors are sent to the login page', { tags: ['smoke', 'auth'] }, async ({ app, browser }) => {
  await openInEnglish(app, browser, '/graph/');
  await expect(browser).toHaveURL('/login/');
});

test('a wrong token is refused with a clear message', { tags: ['auth'] }, async ({ app, screen, browser }) => {
  await openInEnglish(app, browser, '/login/');
  await screen.getByLabel('Access token').fill('dfl_not_a_real_token');
  await screen.getByRole('button', 'Sign in with token').tap();
  await expect(screen.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible();
  await expect(browser).toHaveURL('/login/');
});

test('the right token signs in', { tags: ['smoke', 'auth'] }, async ({ app, screen, browser }) => {
  await openInEnglish(app, browser, '/login/');
  await screen.getByLabel('Access token').fill(credentials.user('admin').password);
  await screen.getByRole('button', 'Sign in with token').tap();
  await expect(screen.getByRole('heading', { name: 'Defluance', level: 1 })).toBeVisible();
  await expect(browser).toHaveURL('/');
});

test('a token in the address fragment signs in and is removed from the address', { tags: ['auth'] }, async ({ app, screen, browser }) => {
  await app.open(`/login/#token=${TOKEN}`);
  await expect(screen.getByRole('heading', { name: 'Defluance', level: 1 })).toBeVisible();
  await expect(browser).toHaveURL('/');
  expect(await browser.evaluate(() => window.location.href)).not.toContain('token');
});

import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('search', { tags: ['search'], session: 'admin' }, () => {
  test('the palette finds a note by its words and opens it', { tags: ['smoke'] }, async ({ app, screen, browser }) => {
    await app.open('/');
    await screen.getByRole('button', 'Search notes').tap();
    const dialog = screen.getByRole('dialog', 'Search');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('HttpOnly cookie');
    const hit = dialog.getByRole('option').filter({ hasText: 'Sessions' }).first();
    await expect(hit).toBeVisible();
    await hit.tap();
    await expect(browser).toHaveURL(/\/n\/tech\/sessions\/?$/);
    await expect(screen.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();
  });

  test('the type filter narrows the palette', async ({ app, screen }) => {
    await app.open('/');
    await screen.getByRole('button', 'Search notes').tap();
    const dialog = screen.getByRole('dialog', 'Search');
    await dialog.getByRole('combobox').fill('token');
    await expect(dialog.getByRole('option').first()).toBeVisible();
    await dialog.getByRole('button', 'Decision (ADR)').tap();
    await expect(dialog.getByRole('option').filter({ hasText: 'ADR 1' }).first()).toBeVisible();
    await expect(dialog.getByRole('option', { name: /^Sessions/ })).toHaveCount(0);
  });

  test('the search page keeps the query in the address and marks the words found', async ({ app, screen, browser }) => {
    await app.open('/search/?q=reset%20link');
    await expect(screen.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();
    await expect(screen.getByRole('link').filter({ hasText: 'Password reset' }).first()).toBeVisible();
    await expect(browser).toHaveURL(/q=reset/);
  });

  test('a query with no match says so', async ({ app, screen }) => {
    await app.open('/search/?q=zzzxqv');
    await expect(screen.getByText('No note matches.', { exact: false })).toBeVisible();
    await expect(screen.getByRole('link').filter({ hasText: 'Password reset' })).toHaveCount(0);
  });
});

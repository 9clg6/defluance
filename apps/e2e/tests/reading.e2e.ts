import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('reading', { tags: ['reading'], session: 'admin' }, () => {
  test('the home page lists what changed and what waits for review', { tags: ['smoke'] }, async ({ app, screen }) => {
    await app.open('/');
    await expect(screen.getByRole('heading', { name: 'Recently updated' })).toBeVisible();
    await expect(screen.getByRole('heading', { name: 'Waiting for review' })).toBeVisible();
  });

  test('a note shows its typed links, its diagram and its unsynced GitHub objects', async ({ app, screen }) => {
    await app.open('/n/produit/auth-login/');
    await expect(screen.getByRole('heading', { name: 'Login', level: 1 })).toBeVisible();
    await expect(screen.getByRole('image', 'Diagram')).toBeVisible();
    // The note's own "# Login" is not repeated under the page title.
    await expect(screen.getByRole('heading', 'Login')).toHaveCount(1);
    // The links live in the "Links (n)" chip under the title, not in a permanent column.
    await screen.getByRole('button', { name: /^Links \(\d+\)$/ }).tap();
    await expect(screen.getByRole('heading', 'Depends on')).toBeVisible();
    await expect(screen.getByRole('link', 'Sessions').first()).toBeVisible();
    await expect(screen.getByText('acme/app#12')).toBeVisible();
    await expect(screen.getByText('not synced')).toBeVisible();
  });

  test('a link in the body navigates to the note it names', async ({ app, screen, browser }) => {
    await app.open('/n/produit/auth-login/');
    await screen.getByRole('article').getByRole('link', 'Password reset').tap();
    await expect(browser).toHaveURL(/\/n\/produit\/password-reset\/?$/);
    await expect(screen.getByRole('heading', { name: 'Password reset', level: 1 })).toBeVisible();
  });

  test('a broken link is marked as such', async ({ app, browser }) => {
    await app.open('/n/produit/refunds/');
    await expect(browser.locator("[title='Broken link: no such note']").first()).toBeVisible();
  });

  test('a note that does not exist offers to create it', async ({ app, screen }) => {
    await app.open('/n/produit/does-not-exist/');
    await expect(screen.getByRole('heading', 'This note does not exist')).toBeVisible();
    await expect(screen.getByRole('button', 'Create this note')).toBeVisible();
  });
});

describe('questions', { tags: ['reading', 'ask'], session: 'admin' }, () => {
  test('an answer cites numbered sources', async ({ app, screen }) => {
    await app.open('/');
    await screen.getByLabel('How does the password reset work?').fill('How long is a reset link valid?');
    await screen.getByRole('button', { name: 'Ask', exact: true }).tap();
    const sources = screen.getByRole('list', 'Sources');
    await expect(sources).toBeVisible();
    await expect(sources.getByRole('link', 'Password reset')).toBeVisible();
  });

  test('nothing is invented when no note supports an answer', async ({ app, screen }) => {
    await app.open('/');
    await screen.getByLabel('How does the password reset work?').fill('What is the airspeed velocity of a swallow?');
    await screen.getByRole('button', { name: 'Ask', exact: true }).tap();
    await expect(screen.getByText('Nothing was invented', { exact: false })).toBeVisible();
  });
});

import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { unique } from './support.ts';

describe('graph', { tags: ['graph'], session: 'admin' }, () => {
  test('the graph is drawn and has an accessible list of the same notes', { tags: ['smoke'] }, async ({ app, screen, browser }) => {
    await app.open('/graph/');
    await expect(browser.locator('canvas')).toBeVisible();
    await screen.getByRole('button', 'Show as a list').tap();
    const list = screen.getByRole('list', 'Notes in the graph');
    await expect(list.getByRole('link', 'Login')).toBeVisible();
    await screen.getByLabel('Type').selectOption({ value: 'adr' });
    await expect(list.getByRole('link')).toHaveCount(1);
  });

  test("a note's local graph and the orphan report", async ({ app, screen, browser }) => {
    await app.open('/n/tech/sessions/?tab=graph');
    await expect(browser.locator('canvas')).toBeVisible();
    await app.open('/graph/?lint=1');
    await expect(screen.getByRole('heading', { name: /orphan notes/ })).toBeVisible();
    await expect(screen.getByText('produit/tax-handling').first()).toBeVisible();
  });
});

describe('settings and audit', { tags: ['settings'], session: 'admin' }, () => {
  test('a token is shown once, then revoked', async ({ app, browser, screen }) => {
    const name = unique('claude-code');
    await app.open('/settings/');
    await screen.getByLabel('Name').fill(name);
    await screen.getByRole('button', 'Create token').tap();
    await expect(screen.getByText('Copy this token now', { exact: false })).toBeVisible();
    await expect(browser.locator('code').filter({ hasText: /^dfl_/ })).toBeVisible();
    const off = await browser.onDialog('accept');
    await screen.getByRole('button', `Revoke ${name}`).tap();
    await off();
    await expect(screen.getByText('Token revoked')).toBeVisible();
    await expect(screen.getByRole('button', `Revoke ${name}`)).toHaveCount(0);
  });

  test('a member is added and removed', async ({ app, screen }) => {
    const login = unique('karim');
    await app.open('/settings/?tab=members');
    await screen.getByLabel('GitHub username').fill(login);
    await screen.getByRole('button', 'Add or change').tap();
    await expect(screen.getByText(login)).toBeVisible();
    await screen.getByRole('button', `Remove ${login}`).tap();
    await expect(screen.getByText(login)).toHaveCount(0);
  });

  test('the GitHub tab explains how to connect, and the old setup address redirects there', async ({ app, screen, browser }) => {
    await app.open('/settings/?tab=github');
    await expect(screen.getByText('Not connected')).toBeVisible();
    await expect(screen.getByText('/webhooks/github', { exact: false }).first()).toBeVisible();
    await app.open('/setup/github/');
    await expect(browser).toHaveURL(/settings\/?\?tab=github/);
  });

  test('opening a GitHub issue says GitHub is not connected', async ({ app, screen }) => {
    await app.open('/n/produit/password-reset/');
    await screen.getByRole('button', 'Open GitHub issue').tap();
    await expect(screen.getByRole('dialog').getByRole('alert')).toContainText('not connected yet');
  });

  test('the audit log lists changes with their author and can be filtered', async ({ app, screen }) => {
    await app.open('/audit/');
    await expect(screen.getByRole('table', 'Audit log')).toBeVisible();
    await screen.getByLabel('Action').fill('token.create');
    await screen.getByRole('button', 'Filter').tap();
    await expect(screen.getByRole('cell', 'token.create').first()).toBeVisible();
  });
});

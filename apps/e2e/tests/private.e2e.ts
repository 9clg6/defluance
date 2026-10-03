import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, openInEnglish, unique } from './support.ts';

const PASS = 'an e2e passphrase for tests';
const MARKER = 'ZEBRAFISH-SECRET-42';

// Each target runs in parallel against one server: a person of its own, so that locking a key here does not lock another target's.
describe('private notes', { tags: ['private'] }, () => {
  test('a key, a private note, locked and unlocked again', async ({ app, screen, browser }) => {
    const base = app.baseUrl as string;
    const who = unique('person');
    const token = (await api<{ token: string }>(base, '/api/v1/tokens', { method: 'POST', body: { name: who, scopes: ['read', 'write', 'admin'], spaces: [] } })).json.token;
    await openInEnglish(app, browser, '/login/');
    await screen.getByLabel('Access token').fill(token);
    await screen.getByRole('button', 'Sign in with token').tap();
    await expect(browser).toHaveURL('/'); // the login page has the same heading: wait until the sign-in has gone through
    await expect(screen.getByRole('heading', { name: 'Defluance', level: 1 })).toBeVisible();

    // create a key
    await app.open('/settings/?tab=private');
    await screen.getByLabel('Name').fill('Work key');
    await screen.getByLabel('Passphrase').fill(PASS);
    await screen.getByLabel('Passphrase (2)').fill(PASS);
    await screen.getByRole('button', 'Create key').tap();
    const card = screen.getByRole('listitem').filter({ hasText: 'Work key' });
    await expect(card.getByText('Locked', { exact: true })).toBeVisible();
    await card.getByLabel(/^Passphrase/).fill(PASS);
    await card.getByRole('button', 'Unlock').tap();
    await expect(card.getByText('Unlocked', { exact: true })).toBeVisible();

    // write a private note
    const title = unique('Minutes');
    await app.open('/');
    await screen.getByRole('button', 'New note').tap();
    const dialog = screen.getByRole('dialog', 'New note');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Folder').fill('scratch');
    await dialog.getByLabel('Private note (encrypted)').check();
    await dialog.getByRole('button', { name: 'Create', exact: true }).tap();
    await expect(screen.getByRole('textbox', 'Markdown editor')).toBeVisible();
    const editor = screen.getByRole('textbox', 'Markdown editor');
    await editor.fill(`---\ntype: note\nstatus: draft\nowner: ${who}\n---\n# ${title}\n\nThe board approved ${MARKER}.\n`);
    await screen.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(screen.getByText(/Saved as commit/)).toBeVisible();

    // locked: nothing of it is left on the page
    await screen.getByRole('button', 'Lock my keys').tap();
    await expect(screen.getByRole('heading', 'This note is private')).toBeVisible();
    await expect(screen.getByText(MARKER, { exact: false })).toHaveCount(0);

    // unlocked from the note itself
    await screen.getByLabel(/^Passphrase/).fill(PASS);
    await screen.getByRole('button', 'Unlock').tap();
    await expect(screen.getByText(MARKER, { exact: false }).first()).toBeVisible();
    await expect(screen.getByRole('heading', 'Who can read it')).toBeVisible();
  });
});

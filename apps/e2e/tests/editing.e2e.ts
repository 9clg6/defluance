import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, unique } from './support.ts';

/** Every test works on a note of its own: the targets share one server and run side by side. */
const RAW = (title: string) => `---\ntype: note\nstatus: draft\nowner: ana\n---\n# ${title}\n\nFirst paragraph.\n`;

async function scratchNote(base: string | undefined, title = 'Scratch note') {
  const id = `scratch/${unique('n')}`;
  const res = await api(base, '/api/v1/notes', { method: 'POST', body: { id, content: RAW(title) } });
  expect(res.status).toBe(201);
  return id;
}

describe('editing', { tags: ['editing'], session: 'admin' }, () => {
  test('saves an edit as a commit and shows it in the history', { tags: ['smoke'] }, async ({ app, screen }) => {
    const id = await scratchNote(app.baseUrl);
    await app.open(`/n/${id}/?tab=edit`);
    const editor = screen.getByRole('textbox', 'Markdown editor');
    await expect(editor).toBeVisible();
    await editor.fill(`${RAW('Scratch note')}\nEvery delivery has a unique id header.\n`);
    await screen.getByRole('button', 'Save').tap();
    await expect(screen.getByText(/Saved as commit [0-9a-f]{7}/)).toBeVisible();
    await expect(screen.getByText('Every delivery has a unique id header.')).toBeVisible();

    await screen.getByRole('tab', 'History').tap();
    await expect(screen.getByRole('table', 'Changes')).toContainText('Every delivery has a unique id header.');
  });

  test('a concurrent edit is reported and never overwritten silently', async ({ app, screen }) => {
    const id = await scratchNote(app.baseUrl);
    await app.open(`/n/${id}/?tab=edit`);
    const editor = screen.getByRole('textbox', 'Markdown editor');
    await editor.fill(`${RAW('Scratch note')}\nMy edit.\n`);

    // Someone else saves first, through the API.
    const path = `/api/v1/notes/${encodeURIComponent(id)}`;
    const current = (await api<{ raw: string; commit: string }>(app.baseUrl, path)).json;
    const theirs = await api(app.baseUrl, path, { method: 'PUT', body: { content: `${current.raw}\nTheir edit.\n`, base_commit: current.commit } });
    expect(theirs.status).toBe(200);

    await screen.getByRole('button', 'Save').tap();
    const alert = screen.getByRole('alert').filter({ hasText: 'changed while you were editing' });
    await expect(alert).toBeVisible();
    await expect(editor).toContainText('My edit.');
    await screen.getByRole('button', 'Keep editing').tap();
    await expect(alert).toHaveCount(0);

    const after = (await api<{ raw: string }>(app.baseUrl, path)).json;
    expect(after.raw).toContain('Their edit.');
    expect(after.raw).not.toContain('My edit.');
  });

  // `press` clicks the editor first, which closes the completion list: accept completions by choosing the option.
  test('the editor completes the target of a wikilink', async ({ app, screen }) => {
    const id = await scratchNote(app.baseUrl);
    await app.open(`/n/${id}/?tab=edit`);
    const editor = screen.getByRole('textbox', 'Markdown editor');
    await editor.fill(`${RAW('Scratch note')}\nSee [[tech/ses`);
    await editor.pressSequentially('s');
    await screen.getByRole('option', { name: /tech\/sessions/ }).tap();
    await expect(editor).toContainText('[[tech/sessions');
  });

  test('the editor completes the type of a link', async ({ app, screen }) => {
    const id = await scratchNote(app.baseUrl);
    await app.open(`/n/${id}/?tab=edit`);
    const editor = screen.getByRole('textbox', 'Markdown editor');
    await editor.fill(`${RAW('Scratch note')}\nSee [[tech/sessions|dep`);
    await editor.pressSequentially('e');
    await screen.getByRole('option', 'depends_on').tap();
    await expect(editor).toContainText('[[tech/sessions|depends_on');
  });

  test('a note is created from the dialog and opens in the editor', async ({ app, screen, browser }) => {
    const title = unique('Audit trail');
    await app.open('/');
    await screen.getByRole('button', 'New note').tap();
    const dialog = screen.getByRole('dialog', 'New note');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Type').selectOption({ label: 'Functional spec' });
    await dialog.getByLabel('Folder').fill('produit');
    await dialog.getByRole('button', { name: 'Create', exact: true }).tap();
    await expect(browser).toHaveURL(/tab=edit/);
    await expect(screen.getByRole('textbox', 'Markdown editor')).toBeVisible();
  });

  test('the status changes from the sidebar and is committed', async ({ app, screen }) => {
    const id = await scratchNote(app.baseUrl);
    await app.open(`/n/${id}/`);
    await screen.getByLabel('Status').selectOption({ value: 'review' });
    await expect(screen.getByText('Status is now review')).toBeVisible();
    const note = (await api<{ frontmatter: { status: string } }>(app.baseUrl, `/api/v1/notes/${encodeURIComponent(id)}`)).json;
    expect(note.frontmatter.status).toBe('review');
  });
});

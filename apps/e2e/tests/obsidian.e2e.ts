import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, unique, uploadPicture } from './support.ts';

const raw = (title: string, body: string) => `---\ntype: note\nstatus: draft\nowner: ana\n---\n# ${title}\n\n${body}\n`;

describe('Obsidian syntax', { tags: ['reading', 'obsidian'], session: 'admin' }, () => {
  test('callouts, highlights, tags, embedded notes and uploaded pictures are rendered', async ({ app, screen, browser }) => {
    const base = app.baseUrl as string;
    const id = `scratch/${unique('obs')}`;
    const other = `${id}-other`;
    await api(base, '/api/v1/notes', { method: 'POST', body: { id: other, content: raw('Other note', 'Embedded sentence.\n\n## Part\n\nOnly this part.') } });
    await api(base, '/api/v1/notes', { method: 'POST', body: { id, content: raw('Obsidian page', `> [!warning] Careful\n> Mind the gap.\n\nSome ==marked== text and #spec-tag here.\n\n![[${other}#Part]]\n`) } });
    const picture = await uploadPicture(base, id);
    const cur = await api<{ raw: string; commit: string }>(base, `/api/v1/notes/${encodeURIComponent(id)}`);
    await api(base, `/api/v1/notes/${encodeURIComponent(id)}`, { method: 'PUT', body: { content: `${cur.json.raw}\n${picture}\n`, base_commit: cur.json.commit } });

    await app.open(`/n/${id}/`);
    await expect(screen.getByRole('heading', { name: 'Obsidian page', level: 1 })).toBeVisible();
    await expect(screen.getByText('Mind the gap.')).toBeVisible();
    await expect(browser.locator('mark')).toBeVisible();
    await expect(browser.locator('.note-tag')).toBeVisible();
    await expect(screen.getByText('Only this part.')).toBeVisible();
    await expect(screen.getByText('Embedded sentence.')).toHaveCount(0);
    await expect(browser.locator('.prose-note img')).toBeVisible();
  });
});

import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { api, RAW, scratchNote } from './support.ts';

/** A second person, as a program: a Yjs document on the same note, connected like the browser's. */
function collaborator(base: string, id: string, token: string) {
  const doc = new Y.Doc();
  class Authed extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { authorization: `Bearer ${token}` } });
    }
  }
  const provider = new WebsocketProvider(`${new URL(base).origin.replace('http', 'ws')}/collab`, encodeURIComponent(id), doc, { WebSocketPolyfill: Authed as never, disableBc: true });
  // awareness only starts counting from the first change
  provider.awareness.setLocalStateField('user', { name: '', color: '#475569' });
  return { doc, text: doc.getText('content'), close: () => provider.destroy() };
}

describe('editing together', { tags: ['collab'], session: 'admin' }, () => {
  test('what another person types appears in the editor, and they are shown as present', async ({ app, screen }) => {
    const base = app.baseUrl as string;
    const id = await scratchNote(base);
    const nadia = (await api<{ token: string }>(base, '/api/v1/tokens', { method: 'POST', body: { name: 'nadia', scopes: ['read', 'write', 'admin'], spaces: [] } })).json.token;

    await app.open(`/n/${id}/?tab=edit`);
    const editor = screen.getByRole('textbox', 'Markdown editor');
    await expect(editor).toBeVisible();
    await expect(screen.getByText('Live', { exact: true })).toBeVisible();

    const peer = collaborator(base, id, nadia);
    try {
      await expect.poll(() => peer.text.toString().includes('First paragraph.')).toBe(true);
      peer.text.insert(peer.text.length, '\nTyped by the other person.\n');
      await expect(editor).toContainText('Typed by the other person.');
      await expect(screen.getByRole('group', { name: /People on this note.*nadia/ })).toBeVisible();
      // their text is not committed until somebody presses Save
      expect((await api<{ raw: string }>(base, `/api/v1/notes/${encodeURIComponent(id)}`)).json.raw).not.toContain('Typed by the other person.');
      await expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    } finally {
      peer.close();
    }
  });

  test('a change made through the API is flagged, and saving reports a conflict instead of overwriting', async ({ app, screen }) => {
    const base = app.baseUrl as string;
    const id = await scratchNote(base);
    const path = `/api/v1/notes/${encodeURIComponent(id)}`;
    await app.open(`/n/${id}/?tab=edit`);
    await expect(screen.getByText('Live', { exact: true })).toBeVisible();
    const editor = screen.getByRole('textbox', 'Markdown editor');
    await editor.fill(`${RAW('Scratch note')}\nMY-UNSAVED-TEXT\n`);

    const cur = (await api<{ raw: string; commit: string }>(base, path)).json;
    expect((await api(base, path, { method: 'PUT', body: { content: `${cur.raw}\nFrom the API.\n`, base_commit: cur.commit } })).status).toBe(200);
    await expect(screen.getByText('saved from outside the editor', { exact: false })).toBeVisible();

    await screen.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(screen.getByRole('alert').filter({ hasText: 'changed while you were editing' })).toBeVisible();
    const after = (await api<{ raw: string }>(base, path)).json;
    expect(after.raw).toContain('From the API.');
    expect(after.raw).not.toContain('MY-UNSAVED-TEXT');
  });
});

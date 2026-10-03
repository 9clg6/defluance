import { expect } from 'e2e';

/** A token that only exists in the throwaway server `scripts/serve.mjs` starts for a run. */
export const TOKEN = 'dfl_e2e_framework_token';

/** Call the REST API as the admin, to prepare or check state the UI should reflect. */
export async function api<T = unknown>(base: string | undefined, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: T }> {
  const res = await fetch(new URL(path, base), {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as T };
}

/** A name no other test uses, so tests that share one server never collide. */
export const unique = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The engine cannot set the browser's language yet, and the app follows it (WebKit inherits the machine's).
 * Pin English the way a user would: through the app's own stored preference, then open the page.
 */
export async function openInEnglish(app: { open(path: string): Promise<void> }, browser: { evaluate(fn: () => unknown): Promise<unknown> }, path: string) {
  await app.open('/login/');
  await browser.evaluate(() => localStorage.setItem('dfl-lang', 'en'));
  await app.open(path);
}

export const RAW = (title: string) => `---\ntype: note\nstatus: draft\nowner: ana\n---\n# ${title}\n\nFirst paragraph.\n`;

export async function scratchNote(base: string | undefined, title = 'Scratch note') {
  const id = `scratch/${unique('n')}`;
  const res = await api(base, '/api/v1/notes', { method: 'POST', body: { id, content: RAW(title) } });
  expect(res.status).toBe(201);
  return id;
}


const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Store a small picture next to a note. Returns the markdown that shows it. */
export async function uploadPicture(base: string | undefined, note: string): Promise<string> {
  const form = new FormData();
  form.set('note', note);
  form.set('file', new File([Buffer.from(PNG_1x1, 'base64')], 'dot.png', { type: 'image/png' }));
  const res = await fetch(new URL('/api/v1/files', base), { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: form });
  expect(res.ok).toBe(true);
  return ((await res.json()) as { markdown: string }).markdown;
}

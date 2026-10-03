import { expect, test } from "@playwright/test";
import { expectAccessible, signIn, TOKEN } from "./helpers";

const auth = { authorization: `Bearer ${TOKEN}` };
const raw = (title: string, body: string) => `---\ntype: note\nstatus: draft\nowner: ana\n---\n# ${title}\n\n${body}\n`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const rand = () => Math.random().toString(36).slice(2, 7);

test.describe("Obsidian syntax and attachments", () => {
  test("renders callouts, highlights, tags, embedded notes and uploaded pictures", async ({ page, request }) => {
    const id = `scratch/obs-${rand()}`;
    const other = `${id}-other`;
    await request.post("/api/v1/notes", { headers: auth, data: { id: other, content: raw("Other note", "Embedded sentence.\n\n## Part\n\nOnly this part.") } });
    await request.post("/api/v1/notes", {
      headers: auth,
      data: { id, content: raw("Obsidian page", `> [!warning] Careful\n> Mind the gap.\n\nSome ==marked== text and #spec-tag here.\n\n![[${other}#Part]]\n`) },
    });
    const file = await request.post("/api/v1/files", { headers: auth, multipart: { note: id, file: { name: "dot.png", mimeType: "image/png", buffer: PNG } } });
    expect(file.ok()).toBe(true);
    const { markdown } = (await file.json()) as { markdown: string };
    const cur = (await (await request.get(`/api/v1/notes/${encodeURIComponent(id)}`, { headers: auth })).json()) as { raw: string; commit: string };
    await request.put(`/api/v1/notes/${encodeURIComponent(id)}`, { headers: auth, data: { content: `${cur.raw}\n${markdown}\n`, base_commit: cur.commit } });

    await signIn(page);
    await page.goto(`/n/${id}/`);
    await expect(page.getByRole("heading", { name: "Obsidian page", level: 1 })).toBeVisible();
    const prose = page.locator(".prose-note");
    await expect(prose.locator(".callout-warning")).toContainText("Mind the gap.");
    await expect(prose.locator("mark")).toHaveText("marked");
    await expect(prose.locator(".note-tag")).toHaveText("#spec-tag");
    await expect(prose.locator(".note-embed")).toContainText("Only this part.");
    await expect(prose.locator(".note-embed")).not.toContainText("Embedded sentence.");
    const img = prose.locator("img");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await expectAccessible(page, "note with Obsidian syntax");
  });

  test("a pasted picture is uploaded and linked where the cursor is", async ({ page, request }) => {
    const id = `scratch/paste-${rand()}`;
    await request.post("/api/v1/notes", { headers: auth, data: { id, content: raw("Paste target", "Text.") } });
    await signIn(page);
    await page.goto(`/n/${id}/?tab=edit`);
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.click();
    await editor.evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG.toString("base64"));
    await expect(editor).toContainText("![[attachments/shot-");
    // the preview is no longer always beside the editor: open it
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".prose-note img")).toBeVisible();
  });
});

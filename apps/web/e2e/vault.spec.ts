import { expect, test } from "@playwright/test";
import { expectAccessible, signIn, TOKEN } from "./helpers";

const auth = { authorization: `Bearer ${TOKEN}` };
const raw = (title: string, body = "First paragraph.") => `---\ntype: note\nstatus: draft\nowner: ana\n---\n# ${title}\n\n${body}\n`;

test.describe("the vault as folders", () => {
  test("shows notes by folder, filters them, and opens one", async ({ page }) => {
    await signIn(page);
    await page.goto("/vault/");
    await expect(page.getByRole("heading", { name: "The vault", level: 1 })).toBeVisible();
    const tree = page.getByRole("tree", { name: "Notes by folder" });
    await expect(tree).toBeVisible();
    await expect(tree.getByRole("treeitem", { name: /produit/ })).toBeVisible();
    await expectAccessible(page, "vault tree");

    await page.getByRole("searchbox", { name: "Filter by title or path" }).fill("sessions");
    const hit = tree.getByRole("treeitem", { name: "Sessions", exact: true });
    await expect(hit).toBeVisible();
    await expect(tree.getByRole("treeitem", { name: /Password reset/ })).toHaveCount(0);
    await hit.click();
    await expect(page).toHaveURL(/\/n\/tech\/sessions/);
    await expect(page.getByRole("heading", { name: "Sessions", level: 1 })).toBeVisible();

    // the breadcrumb leads back to the folder
    await page.getByRole("navigation", { name: "Where the note is" }).getByRole("link", { name: "tech" }).click();
    await expect(page).toHaveURL(/\/vault\/\?q=tech/);
  });

  test("renames a note and the links that point at it follow, then deletes it with a warning", async ({ page, request }) => {
    const id = `scratch/rename-${Math.random().toString(36).slice(2, 7)}`;
    const linker = `${id}-linker`;
    await request.post("/api/v1/notes", { headers: auth, data: { id, content: raw("Moving target") } });
    await request.post("/api/v1/notes", { headers: auth, data: { id: linker, content: raw("Linker", `See [[${id}]].`) } });

    await signIn(page);
    await page.goto(`/n/${id}/`);
    await page.getByRole("button", { name: "Rename or move" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename or move this note" });
    const moved = `${id}-moved`;
    await dialog.getByLabel("New path").fill(moved);
    await dialog.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${moved}/?$`));
    await expect(page.getByRole("heading", { name: "Moving target", level: 1 })).toBeVisible();

    const linkerNote = (await (await request.get(`/api/v1/notes/${encodeURIComponent(linker)}`, { headers: auth })).json()) as { raw: string };
    expect(linkerNote.raw).toContain(`[[${moved}]]`);
    expect((await request.get(`/api/v1/notes/${encodeURIComponent(id)}`, { headers: auth })).status()).toBe(404);

    // one note links to it: the warning says so
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const del = page.getByRole("dialog", { name: "Delete this note?" });
    await expect(del.getByText("1 notes link to it", { exact: false })).toBeVisible();
    await del.getByRole("button", { name: "Delete the note" }).click();
    await expect(page.getByText("Note deleted")).toBeVisible();
    expect((await request.get(`/api/v1/notes/${encodeURIComponent(moved)}`, { headers: auth })).status()).toBe(404);
  });
});

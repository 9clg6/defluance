import { expect, test, type Page } from "@playwright/test";
import { signIn, TOKEN } from "./helpers";

const end = () => (process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");

async function second(page: Page, request: import("@playwright/test").APIRequestContext, name: string) {
  const r = await request.post("/api/v1/tokens", { headers: { authorization: `Bearer ${TOKEN}` }, data: { name, scopes: ["read", "write", "admin"], spaces: [] } });
  const { token } = (await r.json()) as { token: string };
  await page.goto(`/login/#token=${token}`);
  await expect(page.getByRole("heading", { name: "Defluance", level: 1 })).toBeVisible();
}

test.describe("editing a note together", () => {
  test("two people see each other's typing and each other, and a save reaches the other", async ({ browser, request }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await signIn(a);
    await second(b, request, "nadia");

    const url = "/n/produit/password-reset/?tab=edit";
    await a.goto(url);
    await b.goto(url);
    const editorA = a.getByRole("textbox", { name: "Markdown editor" });
    const editorB = b.getByRole("textbox", { name: "Markdown editor" });
    await expect(editorA).toBeVisible();
    await expect(editorB).toBeVisible();
    await expect(a.getByText("Live", { exact: true })).toBeVisible();

    // each sees who else is here
    await expect(a.getByLabel(/People on this note:.*nadia/)).toBeVisible();
    await expect(b.getByLabel(/People on this note:.*bootstrap/)).toBeVisible();

    // typing travels in both directions
    await editorA.click();
    await a.keyboard.press(end());
    await a.keyboard.type("\n\nWritten by the first person.");
    await expect(editorB).toContainText("Written by the first person.");
    await editorB.click();
    await b.keyboard.press(end());
    await b.keyboard.type("\n\nAnd by the second.");
    await expect(editorA).toContainText("And by the second.");

    // the unsaved state is shared: both can save, and nothing is committed yet
    await expect(a.getByRole("button", { name: "Save" })).toBeEnabled();
    await expect(b.getByRole("button", { name: "Save" })).toBeEnabled();

    // one saves: the other is told, and has nothing left to save
    await a.getByRole("button", { name: "Save" }).click();
    await expect(a.getByText(/Saved as commit/)).toBeVisible();
    await expect(b.getByText(/bootstrap saved this note/)).toBeVisible();
    await expect(b.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(editorB).toContainText("Written by the first person.");

    await ctxA.close();
    await ctxB.close();
  });

  test("a change made elsewhere is flagged, and saving reports the conflict instead of overwriting", async ({ browser, request }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto("/n/produit/refunds/?tab=edit");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.click();
    await page.keyboard.press(end());
    await page.keyboard.type("\n\nMy unsaved paragraph.");

    const path = "/api/v1/notes/produit%2Frefunds";
    const cur = await (await request.get(path, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    const theirs = await request.put(path, { headers: { authorization: `Bearer ${TOKEN}` }, data: { content: `${cur.raw}\nFrom the API.\n`, base_commit: cur.commit } });
    expect(theirs.status()).toBe(200);

    await expect(page.getByText(/saved from outside the editor/)).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "changed while you were editing" })).toBeVisible();
    const after = await (await request.get(path, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    expect(after.raw).toContain("From the API.");
    expect(after.raw).not.toContain("My unsaved paragraph.");

    // loading their version replaces the text and clears the warning
    await page.getByRole("button", { name: "Discard mine, load theirs" }).click();
    await expect(editor).toContainText("From the API.");
    await expect(editor).not.toContainText("My unsaved paragraph.");
    await ctx.close();
  });
});

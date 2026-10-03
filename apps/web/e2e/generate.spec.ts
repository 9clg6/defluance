import { expect, test, type Page, type Route } from "@playwright/test";
import { expectAccessible, signIn, TOKEN } from "./helpers";

/** What the server says about itself: a language model or not, live editing or not. */
async function withCapabilities(page: Page, cap: { llm: string | null; collab?: boolean }) {
  await page.route("**/api/v1/me", async (route) => {
    const res = await route.fetch();
    if (!res.ok()) return route.fulfill({ response: res }); // before sign-in the answer is a 401: pass it through
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, capabilities: { ...body.capabilities, ...cap } } });
  });
}

const ADDED = "## Acceptance criteria\n\nGiven a paid order, when a refund is requested within 14 days, then the amount is returned.";

/** Stand in for POST /notes/{id}/generate (the real endpoint needs a language model): answers with the note plus a section. */
async function stubGenerate(page: Page, current: string, o: { status?: number } = {}) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/v1/notes/*/generate", async (route: Route) => {
    bodies.push(route.request().postDataJSON());
    if (o.status) return route.fulfill({ status: o.status, json: { title: o.status === 503 ? "No language model" : "Not allowed" } });
    const base = (bodies.at(-1)?.["content"] as string | undefined) ?? current;
    await route.fulfill({
      json: {
        content: `${base.trimEnd()}\n\n${ADDED}\n`,
        model: "mock:demo",
        grounded_on: [{ id: "tech/sessions", title: "Sessions" }],
        links: [{ to: "tech/sessions", type: "related" }],
        warnings: ["Check the 14 days against the policy."],
      },
    });
  });
  return bodies;
}

const raw = async (request: import("@playwright/test").APIRequestContext) =>
  (await (await request.get("/api/v1/notes/produit%2Frefunds", { headers: { authorization: `Bearer ${TOKEN}` } })).json()) as { raw: string; commit: string };

test.describe("generate with AI", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("the button needs a language model and a draft", async ({ page }) => {
    await withCapabilities(page, { llm: null, collab: false });
    await page.goto("/n/produit/refunds/?tab=edit");
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate with AI" })).toHaveCount(0);

    await page.unroute("**/api/v1/me");
    await withCapabilities(page, { llm: "mock:demo", collab: false });
    await page.goto("/n/produit/password-reset/?tab=edit"); // in review, not a draft
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate with AI" })).toHaveCount(0);

    await page.goto("/n/produit/refunds/?tab=edit");
    await expect(page.getByRole("button", { name: "Generate with AI" })).toBeVisible();
  });

  test("generate, review the diff, apply to the editor: nothing is saved until Save", async ({ page, request }) => {
    await withCapabilities(page, { llm: "mock:demo", collab: false });
    const before = await raw(request);
    const bodies = await stubGenerate(page, before.raw);
    await page.goto("/n/produit/refunds/?tab=edit");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(editor).toBeVisible();

    await page.getByRole("button", { name: "Generate with AI" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: "Fill from template" })).toBeChecked();
    await dialog.getByRole("button", { name: "Shorten" }).click();
    await dialog.getByRole("button", { name: "Add edge cases" }).click();
    await expect(dialog.getByLabel("Instruction")).toHaveValue("Shorten\nAdd edge cases");
    await expectAccessible(page, "generate dialog");
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();

    // review: what the model wrote against the editor, where it drew on, what to check
    await expect(dialog.getByRole("table", { name: "Editor text against generated text" })).toContainText("Given a paid order");
    await expect(dialog.getByRole("link", { name: "Sessions" })).toHaveAttribute("href", /\/n\/tech\/sessions/);
    await expect(dialog.getByRole("alert")).toContainText("Check the 14 days");
    await expectAccessible(page, "generate review");
    expect(bodies).toEqual([{ mode: "fill", instruction: "Shorten\nAdd edge cases" }]); // the editor is unchanged: no content sent

    await dialog.getByRole("button", { name: "Apply to editor" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(editor).toContainText("Given a paid order");
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
    expect((await raw(request)).raw).toBe(before.raw); // not saved

    // typed text is sent along when it differs from the saved note, and Discard leaves the editor alone
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await dialog.getByRole("radio", { name: "Improve what is written" }).check();
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(dialog.getByRole("table")).toBeVisible();
    expect(bodies[1]).toMatchObject({ mode: "improve", content: expect.stringContaining("Given a paid order") });
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(editor).toContainText("Given a paid order");
  });

  test("a server without a language model says so inside the dialog", async ({ page, request }) => {
    await withCapabilities(page, { llm: "mock:demo", collab: false });
    await stubGenerate(page, (await raw(request)).raw, { status: 503 });
    await page.goto("/n/produit/refunds/?tab=edit");
    await page.getByRole("button", { name: "Generate with AI" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("No language model is available");
    await expect(dialog.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
  });

  test("in a live editor the text goes through the shared document", async ({ page, request }) => {
    await withCapabilities(page, { llm: "mock:demo" }); // collab stays on: the server offers it
    const before = await raw(request);
    await stubGenerate(page, before.raw);
    await page.goto("/n/produit/refunds/?tab=edit");
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(editor).toBeVisible();

    await page.getByRole("button", { name: "Generate with AI" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    await dialog.getByRole("button", { name: "Apply to editor" }).click();
    await expect(editor).toContainText("Given a paid order");
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled(); // the shared text now differs from the commit
    expect((await raw(request)).raw).toBe(before.raw);
    // a reload finds the shared draft (the server keeps it): the point is that it went through Y.Text
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Markdown editor" })).toContainText("Given a paid order");
  });

  test("a brief written when creating a note opens the dialog with it, without calling the model", async ({ page, request }) => {
    await withCapabilities(page, { llm: "mock:demo", collab: false });
    const bodies = await stubGenerate(page, "");
    await page.goto("/");
    await page.getByRole("button", { name: "New note" }).click();
    const create = page.getByRole("dialog", { name: "New note" });
    await create.getByLabel("Title").fill("Generate brief demo");
    await create.getByLabel("Describe what it should cover").fill("Export of invoices as CSV");
    await expectAccessible(page, "new note with a brief");
    await create.getByRole("button", { name: "Create" }).click();
    try {
      await expect(page).toHaveURL(/tab=edit/);
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Instruction")).toHaveValue("Export of invoices as CSV");
      await expect(dialog.getByRole("radio", { name: "Fill from template" })).toBeChecked();
      expect(bodies).toEqual([]);
      await expect(page).not.toHaveURL(/generate=/); // taken once
    } finally {
      await request.delete("/api/v1/notes/generate-brief-demo", { headers: { authorization: `Bearer ${TOKEN}` } });
    }
  });
});

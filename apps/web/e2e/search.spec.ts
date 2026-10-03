import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, signIn } from "./helpers";

/** Pretend the server has a meaning model and a language model: the interface should then offer every mode. */
async function withCapabilities(page: Page, cap: object = { semantic: true, embedder: "local:test", llm: "mock:llm", deep: true }) {
  await page.route("**/api/v1/me", async (route) => {
    const res = await route.fetch();
    if (!res.ok()) return route.fulfill({ response: res }); // before sign-in the answer is a 401: pass it through
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, capabilities: cap } });
  });
}

test.describe("search page", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("finds notes, marks the matched words, and keeps the search in the address", async ({ page }) => {
    await page.goto("/search/");
    await expect(page.getByText("Type a question or a few words.")).toBeVisible();
    await page.getByRole("searchbox").or(page.getByRole("textbox", { name: "Search notes…" })).first().fill("refresh token");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("link", { name: "Sessions" }).first()).toBeVisible();
    await expect(page.locator("mark").first()).toContainText(/refresh|token/i);
    await expect(page).toHaveURL(/search\/\?q=refresh\+token/);
    await expectAccessible(page, "search results");

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Search notes…" })).toHaveValue("refresh token");
    await expect(page.getByRole("link", { name: "Sessions" }).first()).toBeVisible();
  });

  test("filters by type and status, and offers to ask the question", async ({ page }) => {
    await page.goto("/search/?q=token");
    await expect(page.locator("article").first()).toBeVisible();
    await page.getByLabel("Type", { exact: true }).selectOption("adr");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText("ADR 1");
    await page.getByLabel("Type", { exact: true }).selectOption("");
    await page.getByRole("link", { name: "Ask it as a question" }).click();
    await expect(page).toHaveURL(/\?ask=token/);
  });

  test("says what it does when there is nothing", async ({ page }) => {
    await page.goto("/search/?q=zzzzqqqq");
    await expect(page.getByText("No note matches")).toBeVisible();
  });

  test("meaning and smart are off without the models, and say how to turn them on", async ({ page }) => {
    await page.goto("/search/");
    const meaning = page.getByRole("radio", { name: "Meaning" });
    const smart = page.getByRole("radio", { name: "Smart" });
    await expect(meaning).toHaveAttribute("aria-disabled", "true");
    await expect(smart).toHaveAttribute("aria-disabled", "true");
    await meaning.click({ force: true }); // aria-disabled: Playwright waits for "enabled", a person can click
    await expect(page.locator("#page-mode-help")).toContainText("defluance models install");
    await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    await smart.click({ force: true });
    await expect(page.locator("#page-mode-help")).toContainText("set DFL_LLM on the server");
    await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Words" }).click();
    await expect(page.getByRole("radio", { name: "Words" })).toHaveAttribute("aria-checked", "true");
    await expectAccessible(page, "mode picker");
  });
});

test.describe("palette", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("offers the modes and a link to all results", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog.getByRole("radiogroup", { name: "Search mode" })).toBeVisible();
    await dialog.getByRole("combobox").fill("webhook signature");
    await expect(dialog.getByRole("option", { name: /^Webhooks/ })).toBeVisible();
    await dialog.getByRole("option", { name: /See all results/ }).click();
    await expect(page).toHaveURL(/search\/\?q=webhook(%20|\+)signature/);
    await expect(page.getByRole("link", { name: "Webhooks" }).first()).toBeVisible();
  });
});

test.describe("with a meaning model and a language model (server capabilities simulated)", () => {
  test("every mode is available, and smart search shows how the question was understood", async ({ page }) => {
    await withCapabilities(page);
    let asked = "";
    await page.route("**/api/v1/search/smart**", async (route) => {
      asked = route.request().url();
      await route.fulfill({
        json: {
          hits: [{ note: { id: "tech/sessions", title: "Sessions", type: "technical-spec", status: "approved", space: "tech", tags: [] }, chunk: { id: "c1", heading: "Sessions", snippet: "Access tokens expire after fifteen minutes.", commit: null }, score: 0.03, sources: ["vector", "fts"] }],
          understood: { queries: ["how long do logins last", "session token expiry"], filters: { status: "approved", type: "technical-spec" }, filtersDropped: false, reranked: true },
        },
      });
    });
    await signIn(page);
    await page.goto("/search/");
    await expect(page.getByRole("radio", { name: "Meaning" })).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("radio", { name: "Smart" })).not.toHaveAttribute("aria-disabled", "true");
    await page.getByRole("radio", { name: "Smart" }).click();
    await expect(page.getByRole("radio", { name: "Smart" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("textbox", { name: "Search notes…" }).fill("how long do logins last");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const understood = page.getByRole("region", { name: "Understood as" });
    await expect(understood).toBeVisible();
    await expect(understood).toContainText("session token expiry");
    await expect(understood.getByText("Approved")).toBeVisible();
    await expect(understood.getByText("Technical spec")).toBeVisible();
    await expect(understood).toContainText("reordered by the model");
    await expect(page.getByRole("link", { name: "Sessions" }).first()).toBeVisible();
    await expect(page.getByText("words + meaning").or(page.getByText("meaning + words")).first()).toBeVisible();
    expect(asked).toContain("q=how+long+do+logins+last");
    await expect(page).toHaveURL(/mode=smart/);
    await expectAccessible(page, "smart search");
  });

  test("smart search that fell back says why", async ({ page }) => {
    await withCapabilities(page);
    await page.route("**/api/v1/search/smart**", (route) => route.fulfill({ json: { hits: [], understood: { queries: ["x"], filters: {}, filtersDropped: false, reranked: false, fallback: "the model could not plan the search: 503" } } }));
    await signIn(page);
    await page.goto("/search/?q=x&mode=smart");
    await expect(page.getByText("Plain search was used: the model could not plan the search: 503")).toBeVisible();
  });

  test("meaning mode sends the mode to the server", async ({ page }) => {
    await withCapabilities(page);
    let url = "";
    await page.route("**/api/v1/search?**", async (route) => {
      url = route.request().url();
      await route.continue();
    });
    await signIn(page);
    await page.goto("/search/?q=token&mode=meaning");
    await expect(page.getByRole("radio", { name: "Meaning" })).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => url).toContain("mode=meaning");
  });

  test("deep search shows the steps the agent took", async ({ page }) => {
    await withCapabilities(page);
    let body: Record<string, unknown> = {};
    await page.route("**/api/v1/ask", async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({
        json: {
          answer: "Login sessions last fifteen minutes [1].",
          citations: [{ n: 1, note: "tech/sessions", title: "Sessions", heading: "Sessions", commit: "abc1234def", snippet: "Access tokens expire after fifteen minutes." }],
          refused: false,
          mode: "deep",
          steps: [
            { tool: "search", input: "session cookies expire", summary: "3 passages" },
            { tool: "read_note", input: "tech/sessions", summary: "Sessions" },
            { tool: "neighbors", input: "tech/sessions", summary: "2 links" },
          ],
        },
      });
    });
    await signIn(page);
    const deep = page.getByRole("checkbox", { name: /Research in depth/ });
    await expect(deep).toBeVisible();
    await deep.check();
    await page.getByLabel("How does the password reset work?").fill("How long do sessions last?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("researched in depth")).toBeVisible();
    expect(body["deep"]).toBe(true);
    const steps = page.getByText(/How it searched \(3\)/);
    await expect(steps).toBeVisible();
    await steps.click();
    await expect(page.getByText("Searched “session cookies expire” (3 passages)")).toBeVisible();
    await expect(page.getByText("Read Sessions")).toBeVisible();
    await expect(page.getByText("Looked at the links of tech/sessions (2 links)")).toBeVisible();
    await expect(page.getByRole("list", { name: "Sources" }).getByRole("link", { name: "Sessions" })).toBeVisible();
    await expectAccessible(page, "deep answer");
  });

  test("the deep option is hidden without a tool-capable model", async ({ page }) => {
    await withCapabilities(page, { semantic: true, embedder: "local:test", llm: "plain", deep: false });
    await signIn(page);
    await expect(page.getByRole("checkbox", { name: /Research in depth/ })).toHaveCount(0);
  });
});

test.describe("search status banners", () => {
  test("without a meaning model a dismissible hint explains how to get one", async ({ page }) => {
    await signIn(page);
    const hint = page.getByText(/Search matches words, not meaning/);
    await expect(hint).toBeVisible();
    await expectAccessible(page, "words hint");
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Recently updated" })).toBeVisible();
    await expect(page.getByText(/Search matches words, not meaning/)).toHaveCount(0);
  });

  test("shows the progress of the vectors being prepared", async ({ page }) => {
    await withCapabilities(page);
    await page.route("**/api/v1/index/status", async (route) => {
      const res = await route.fetch();
      if (!res.ok()) return route.fulfill({ response: res }); // before sign-in the answer is a 401: pass it through
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, capabilities: { semantic: true, embedder: "local:test", llm: null, deep: false }, embedding: { running: true, done: 120, total: 400, error: null, pending: 280 } } });
    });
    await signIn(page);
    await expect(page.getByText("Preparing search by meaning: 120 of 400 passages")).toBeVisible();
    await expect(page.locator("progress")).toHaveAttribute("value", "120");
    await expectAccessible(page, "embedding progress");
  });

  test("reports a failing model while keyword search keeps working", async ({ page }) => {
    await withCapabilities(page);
    await page.route("**/api/v1/index/status", async (route) => {
      const res = await route.fetch();
      if (!res.ok()) return route.fulfill({ response: res }); // before sign-in the answer is a 401: pass it through
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, capabilities: { semantic: true, embedder: "local:test", llm: null, deep: false }, embedding: { running: false, done: 0, total: 0, error: "model download failed", pending: 280 } } });
    });
    await signIn(page);
    await expect(page.getByText(/Search by meaning is paused \(model download failed\)/)).toBeVisible();
    await page.goto("/search/?q=sessions&mode=keyword");
    await expect(page.getByRole("link", { name: "Sessions" }).first()).toBeVisible();
  });

  test("the French interface is complete", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Switch language" }).click();
    await page.goto("/search/?q=sessions");
    await expect(page.getByRole("radiogroup", { name: "Mode de recherche" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Mots" })).toBeVisible();
    await expect(page.getByRole("link", { name: "La poser comme une question" })).toBeVisible();
    await expectAccessible(page, "search in French");
  });
});

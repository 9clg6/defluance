import { PORT } from "../playwright.config";
import { expect, test } from "@playwright/test";
import { expectAccessible, signIn, TOKEN } from "./helpers";

test.describe("sign in", () => {
  test("sends visitors to the login page, rejects a bad token, accepts a good one", async ({ page }) => {
    await page.goto("/graph/");
    await expect(page).toHaveURL(/\/login\/?$/);
    await expectAccessible(page, "login");
    await page.getByLabel("Access token").fill("dfl_wrong");
    await page.getByRole("button", { name: "Sign in with token" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "not valid" })).toBeVisible();
    await page.getByLabel("Access token").fill(TOKEN);
    await page.getByRole("button", { name: "Sign in with token" }).click();
    await expect(page.getByRole("heading", { name: "Defluance", level: 1 })).toBeVisible();
  });

  test("a token in the address fragment signs in and disappears from the URL", async ({ page }) => {
    await page.goto(`/login/#token=${TOKEN}`);
    await expect(page).toHaveURL(/\/$/);
    expect(page.url()).not.toContain("token");
  });
});

test.describe("reading and searching", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("home page is accessible and shows the vault", async ({ page }) => {
    await expect(page.getByText("Notes", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recently updated" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Waiting for review" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where the specs stand" })).toBeVisible();
    const table = page.getByRole("table", { name: "Notes by type and status" });
    await expect(table.getByRole("row", { name: /Functional spec/ })).toContainText(/Approved: \d/);
    await expectAccessible(page, "home");
  });

  test("Ctrl+K opens search, finds a note and opens it", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").fill("HttpOnly cookie");
    await expect(dialog.getByRole("option", { name: /^Sessions/ })).toBeVisible();
    await expectAccessible(page, "search palette");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/n\/tech\/sessions/);
    await expect(page.getByRole("heading", { name: "Sessions", level: 1 })).toBeVisible();
  });

  test("filters search by type and status", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await dialog.getByRole("combobox").fill("token");
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await dialog.getByRole("button", { name: "Decision (ADR)" }).click();
    await expect(dialog.getByRole("option", { name: /ADR 1/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /^Sessions/ })).toHaveCount(0);
  });

  test("a note shows its links grouped by type, a diagram, and unsynced GitHub objects", async ({ page }) => {
    await page.goto("/n/produit/auth-login/");
    await expect(page.getByRole("heading", { name: "Login", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Depends on" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sessions" }).first()).toBeVisible();
    await expect(page.getByText("acme/app#12")).toBeVisible();
    await expect(page.getByText("not synced")).toBeVisible();
    await expect(page.getByRole("img", { name: "Diagram" })).toBeVisible();
    // the note's own "# Login" is not repeated under the page title
    await expect(page.getByRole("heading", { name: "Login" })).toHaveCount(1);
    await expectAccessible(page, "note");
  });

  test("wikilinks in the body navigate, and a broken one is marked", async ({ page }) => {
    await page.goto("/n/produit/refunds/");
    await expect(page.locator("[title='Broken link: no such note']").first()).toBeVisible();
    await page.goto("/n/produit/auth-login/");
    await page.getByRole("article").getByRole("link", { name: "Password reset" }).click();
    await expect(page).toHaveURL(/produit\/password-reset/);
  });

  test("an unknown note offers to create it", async ({ page }) => {
    await page.goto("/n/produit/does-not-exist/");
    await expect(page.getByRole("heading", { name: "This note does not exist" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create this note" })).toBeVisible();
  });
});

test.describe("editing", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("edits a note, saves it as a commit, and shows it in the history", async ({ page }) => {
    await page.goto("/n/tech/webhooks/?tab=edit");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(editor).toBeVisible();
    await expectAccessible(page, "editor");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\nEvery delivery has a unique id header.");
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved as commit [0-9a-f]{7}/)).toBeVisible();
    // the shared editor stays open after a save: the text is in the editor and in the preview
    await expect(page.getByText("Every delivery has a unique id header.").first()).toBeVisible();

    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByRole("button", { name: /update tech\/webhooks/ })).toBeVisible();
    await expect(page.getByRole("table", { name: "Changes" })).toContainText("Every delivery has a unique id header.");
    await expectAccessible(page, "history");
  });

  test("completes wikilinks and link types while typing", async ({ page }) => {
    await page.goto("/n/tech/glossary/?tab=edit");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\nSee [[tech/sess");
    const option = page.getByRole("option", { name: /tech\/sessions/ });
    await expect(option).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("|depe");
    await expect(page.getByRole("option", { name: "depends_on" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(editor).toContainText("[[tech/sessions|depends_on");
  });

  test("a concurrent edit is reported, never overwritten silently", async ({ page, request }) => {
    await page.goto("/n/tech/rate-limiting/?tab=edit");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\nMy edit.");

    // someone else saves first, through the API
    const current = await (await request.get("/api/v1/notes/tech%2Frate-limiting", { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    const theirs = await request.put("/api/v1/notes/tech%2Frate-limiting", { headers: { authorization: `Bearer ${TOKEN}` }, data: { content: `${current.raw}\nTheir edit.\n`, base_commit: current.commit } });
    expect(theirs.status()).toBe(200);

    await page.getByRole("button", { name: "Save" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "changed while you were editing" });
    await expect(alert).toBeVisible();
    await expect(editor).toContainText("My edit.");
    await expectAccessible(page, "conflict banner");
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(alert).toHaveCount(0);
    await expect(editor).toContainText("My edit.");

    // the server still has theirs
    const after = await (await request.get("/api/v1/notes/tech%2Frate-limiting", { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    expect(after.raw).toContain("Their edit.");
    expect(after.raw).not.toContain("My edit.");
  });

  test("creates a note from the dialog and lands in the editor", async ({ page }) => {
    await page.getByRole("button", { name: "New note" }).click();
    const dialog = page.getByRole("dialog", { name: "New note" });
    await dialog.getByLabel("Title").fill("Audit trail");
    await dialog.getByLabel("Type").selectOption({ label: "Functional spec" });
    await dialog.getByLabel("Folder").fill("produit");
    await expect(dialog.getByText("produit/audit-trail.md")).toBeVisible();
    await expectAccessible(page, "new note dialog");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/produit\/audit-trail\/?\?tab=edit/);
    await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();
  });

  test("changes a note's status from the sidebar", async ({ page }) => {
    await page.goto("/n/tech/webhooks/");
    await page.getByLabel("Status").selectOption("review");
    await expect(page.getByText("Status is now review")).toBeVisible();
    await expect(page.getByText("In review").first()).toBeVisible();
  });
});

test.describe("questions, graph, settings, audit", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("answers a question with numbered sources and refuses without any", async ({ page }) => {
    await page.getByLabel("How does the password reset work?").fill("How long is a reset link valid?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const sources = page.getByRole("list", { name: "Sources" });
    await expect(sources).toBeVisible();
    await expect(sources.getByRole("link", { name: "Password reset" })).toBeVisible();
    await expectAccessible(page, "answer");
    await page.getByLabel("How does the password reset work?").fill("What is the airspeed velocity of a swallow?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Nothing was invented")).toBeVisible();
  });

  test("a note's Ask tab only uses that note and its neighbours", async ({ page }) => {
    await page.goto("/n/produit/billing-invoices/?tab=ask");
    await expect(page.getByText("Answers use this note and the notes linked to it.")).toBeVisible();
    await page.getByLabel("How does the password reset work?").fill("How long is a reset link valid?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Nothing was invented")).toBeVisible();
  });

  test("the graph page draws notes and offers an accessible list", async ({ page }) => {
    await page.goto("/graph/");
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("button", { name: "Show as a list" }).click();
    const list = page.getByRole("list", { name: "Notes in the graph" });
    await expect(list.getByRole("link", { name: "Login" })).toBeVisible();
    await page.getByLabel("Type", { exact: true }).selectOption("adr");
    await expect(list.getByRole("link")).toHaveCount(1);
    await expectAccessible(page, "graph");
  });

  test("local graph tab and orphan report", async ({ page }) => {
    await page.goto("/n/tech/sessions/?tab=graph");
    await expect(page.locator("canvas")).toBeVisible();
    await page.goto("/graph/?lint=1");
    await expect(page.getByRole("heading", { name: /orphan notes/ })).toBeVisible();
    await expect(page.getByText("produit/tax-handling").first()).toBeVisible();
  });

  test("settings: creates a token shown once, then revokes it", async ({ page }) => {
    await page.goto("/settings/");
    await expectAccessible(page, "settings");
    await page.getByLabel("Name", { exact: true }).fill("claude-code");
    await page.getByRole("button", { name: "Create token" }).click();
    await expect(page.getByText("Copy this token now")).toBeVisible();
    await expect(page.locator("code").filter({ hasText: /^dfl_/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy the Claude Code command" })).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Revoke claude-code" }).click();
    await expect(page.getByText("Token revoked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Revoke claude-code" })).toHaveCount(0);
  });

  test("settings: members and the GitHub setup guide", async ({ page }) => {
    await page.goto("/settings/?tab=members");
    await page.getByLabel("GitHub username").fill("karim");
    await page.getByRole("button", { name: "Add or change" }).click();
    await expect(page.getByText("karim")).toBeVisible();
    await page.getByRole("button", { name: "Remove karim" }).click();
    await expect(page.getByText("No members yet.")).toBeVisible();
    await page.goto("/settings/?tab=github");
    await expect(page.getByText("Not connected")).toBeVisible();
    await expect(page.getByText("/webhooks/github")).toBeVisible();
    await expectAccessible(page, "github setup");
    await page.goto("/setup/github/");
    await expect(page).toHaveURL(/settings\/?\?tab=github/);
  });

  test("opening a GitHub issue explains that GitHub is not connected", async ({ page }) => {
    await page.goto("/n/produit/password-reset/");
    await page.getByRole("button", { name: "Open GitHub issue" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("not connected yet");
  });

  test("the audit log lists every change with its author", async ({ page }) => {
    await page.goto("/audit/");
    await expect(page.getByRole("table", { name: "Audit log" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "note.update" }).first()).toBeVisible();
    await page.getByLabel("Action").fill("token.create");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("cell", { name: "token.create" }).first()).toBeVisible();
    await expectAccessible(page, "audit");
  });
});

test.describe("preferences and small screens", () => {
  test("dark theme and French persist across reloads", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Toggle light and dark theme" }).click();
    const theme = async () => page.evaluate(() => document.documentElement.classList.contains("dark"));
    const first = await theme();
    await page.reload();
    expect(await theme()).toBe(first);
    await page.getByRole("button", { name: "Switch language" }).click();
    await expect(page.getByRole("heading", { name: "Mises à jour récemment" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Mises à jour récemment" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expectAccessible(page, "home in French");
  });

  test("both themes keep sufficient contrast", async ({ page }) => {
    await signIn(page);
    for (const dark of [false, true]) {
      await page.evaluate((d) => document.documentElement.classList.toggle("dark", d), dark);
      await expectAccessible(page, dark ? "dark home" : "light home");
      await page.goto("/n/produit/auth-login/");
      await page.evaluate((d) => document.documentElement.classList.toggle("dark", d), dark);
      await expectAccessible(page, dark ? "dark note" : "light note");
      await page.goto("/");
    }
  });

  test("no horizontal scroll on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn(page);
    for (const path of ["/", "/n/produit/auth-login/", "/graph/", "/settings/", "/audit/"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
  });

  test("honours reduced motion", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: `http://127.0.0.1:${PORT}` });
    const page = await ctx.newPage();
    await signIn(page);
    const transform = await page.evaluate(() => getComputedStyle(document.querySelector(".obsidian-draggable-marquee > div") ?? document.body).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
    await ctx.close();
  });
});

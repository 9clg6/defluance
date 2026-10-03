import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectAccessible, signIn, TOKEN } from "./helpers";

const auth = { authorization: `Bearer ${TOKEN}` };
const rand = () => Math.random().toString(36).slice(2, 7);
const mod = process.platform === "darwin" ? "Meta" : "Control";
const end = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const FM = "---\ntype: note\nstatus: draft\nowner: ana\n---\n";
const editorOf = (page: Page) => page.getByRole("textbox", { name: "Markdown editor" });
const toolbarOf = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const button = (page: Page, name: string) => toolbarOf(page).getByRole("button", { name, exact: true });

/** A scratch note with this body under its frontmatter, opened in the editor with the cursor at the very end. */
async function open(page: Page, request: APIRequestContext, body: string): Promise<string> {
  const id = `scratch/ed-${rand()}`;
  expect((await request.post("/api/v1/notes", { headers: auth, data: { id, content: FM + body } })).ok()).toBe(true);
  await page.goto(`/n/${id}/?tab=edit`);
  await expect(editorOf(page)).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await editorOf(page).click();
  await page.keyboard.press(end);
  return id;
}

/** Save, then read the note back through the API: what is stored, byte for byte, without its frontmatter. */
async function saved(page: Page, request: APIRequestContext, id: string): Promise<string> {
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Saved as commit/)).toBeVisible();
  const note = (await (await request.get(`/api/v1/notes/${encodeURIComponent(id)}`, { headers: auth })).json()) as { raw: string };
  expect(note.raw.startsWith(FM)).toBe(true);
  return note.raw.slice(FM.length);
}

test.describe("formatting toolbar", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("bold, heading, list and link write exactly the Markdown that is expected", async ({ page, request }) => {
    const id = await open(page, request, "Intro\n");
    // the toolbar is named and every button has a name
    await expect(toolbarOf(page)).toBeVisible();

    await page.keyboard.type("Title");
    await page.keyboard.press("Shift+Home");
    await toolbarOf(page).getByRole("combobox", { name: "Heading" }).selectOption("1");
    await expect(toolbarOf(page).getByRole("combobox", { name: "Heading" })).toHaveValue("1");

    await page.keyboard.press("End");
    await page.keyboard.type("\n\nmake it bold");
    await page.keyboard.press("Shift+Home");
    await button(page, "Bold").click();
    await expect(button(page, "Bold")).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("End");
    await page.keyboard.type("\n\none");
    await button(page, "Bulleted list").click();
    await expect(button(page, "Bulleted list")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("End");
    await page.keyboard.type("\ntwo");
    // a second Enter on the empty item ends the list; a third leaves a blank line before the next paragraph
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await page.keyboard.type("see docs");
    await page.keyboard.press("Shift+Home");
    await button(page, "Link").click();
    const panel = page.getByRole("group", { name: "Insert a link" });
    await panel.getByLabel("Web address").fill("https://example.com/docs");
    await panel.getByRole("button", { name: "Apply" }).click();
    await expect(panel).toHaveCount(0);

    expect(await saved(page, request, id)).toBe("Intro\n# Title\n\n**make it bold**\n\n- one\n- two\n\n[see docs](https://example.com/docs)");
  });

  test("an empty selection inserts a placeholder that is selected for overwriting; the button is pressed inside it and takes it off", async ({ page, request }) => {
    const id = await open(page, request, "start ");
    await button(page, "Italic").click();
    await page.keyboard.type("slanted");
    await expect(button(page, "Italic")).toHaveAttribute("aria-pressed", "true");
    // the cursor is on this line, so its marks are shown
    await expect(editorOf(page).locator(".cm-lp-em")).toHaveText("*slanted*");
    await button(page, "Italic").click();
    await expect(editorOf(page).locator(".cm-lp-em")).toHaveCount(0);
    expect(await saved(page, request, id)).toBe("start slanted");
  });

  test("checklist, horizontal rule, quote, table and callout", async ({ page, request }) => {
    const id = await open(page, request, "task");
    await button(page, "Checklist").click();
    await button(page, "Horizontal rule").click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("quote");
    await button(page, "Quote").click();
    await button(page, "Table").click();
    await page.keyboard.press(end);
    await toolbarOf(page).getByRole("combobox", { name: "Callout" }).selectOption("warning");
    await page.keyboard.type("Careful");
    expect(await saved(page, request, id)).toBe(
      [
        "- [ ] task",
        "",
        "---",
        "",
        "> quote",
        "",
        "| Column 1 | Column 2 | Column 3 |",
        "| --- | --- | --- |",
        "|  |  |  |",
        "|  |  |  |",
        "",
        "> [!warning] Careful",
        "",
      ].join("\n"),
    );
  });

  test("a code block fences the selected lines and unfences them", async ({ page, request }) => {
    const id = await open(page, request, "let x = 1;");
    await page.keyboard.press("Shift+Home");
    await button(page, "Code block").click();
    await expect(button(page, "Code block")).toHaveAttribute("aria-pressed", "true");
    await expect(editorOf(page).locator(".cm-lp-code")).toHaveCount(3);
    expect(await saved(page, request, id)).toBe("```\nlet x = 1;\n```");
  });

  test("shortcuts: bold and heading, then the same heading again to go back", async ({ page, request }) => {
    const id = await open(page, request, "word");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.press(`${mod}+Alt+2`);
    await expect(editorOf(page).locator(".cm-lp-h2")).toHaveCount(1);
    await page.keyboard.press(`${mod}+Alt+2`);
    await expect(editorOf(page).locator(".cm-lp-h2")).toHaveCount(0);
    await page.keyboard.press(`${mod}+Shift+8`);
    expect(await saved(page, request, id)).toBe("- **word**");
  });

  test("a note link from the picker, with a link type", async ({ page, request }) => {
    const id = await open(page, request, "see ");
    await button(page, "Note link").click();
    const panel = page.getByRole("group", { name: "Link to a note" });
    await panel.getByLabel("Find a note").fill("glossary");
    await panel.getByLabel("Link type").selectOption("related");
    await panel.getByRole("list", { name: "Notes" }).getByRole("button", { name: /tech\/glossary/ }).click();
    expect(await saved(page, request, id)).toBe("see [[tech/glossary|related]]");
  });

  test("an image or file is uploaded, then inserted as an embed", async ({ page, request }) => {
    const id = await open(page, request, "pic: ");
    await page.getByTestId("editor-file").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG });
    await expect(editorOf(page)).toContainText("![[attachments/");
    expect(await saved(page, request, id)).toMatch(/^pic: !\[\[attachments\/dot-?[\w-]*\.png\]\]\n$/);
  });

  test("undo and redo buttons follow the shared history", async ({ page, request }) => {
    const id = await open(page, request, "plain");
    await page.keyboard.press("Shift+Home");
    await button(page, "Bold").click();
    await expect(editorOf(page).locator(".cm-lp-strong")).toHaveCount(1);
    await button(page, "Undo").click();
    await expect(editorOf(page).locator(".cm-lp-strong")).toHaveCount(0);
    await button(page, "Redo").click();
    await expect(editorOf(page).locator(".cm-lp-strong")).toHaveCount(1);
    expect(await saved(page, request, id)).toBe("**plain**");
  });
});

test.describe("live preview", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("hides the marks away from the cursor and shows them on its line, without changing the text", async ({ page, request }) => {
    const id = await open(page, request, "**bold** first\n\nsecond line");
    const editor = editorOf(page);
    await expect(editor).toContainText("second line");
    await expect(editor).not.toContainText("**");
    await expect(editor.locator(".cm-lp-strong")).toHaveText("bold");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(editor).toContainText("**bold** first");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(editor).not.toContainText("**");
    // nothing was typed: saving is a no-op, and the stored text is what was written
    const note = (await (await request.get(`/api/v1/notes/${encodeURIComponent(id)}`, { headers: auth })).json()) as { raw: string };
    expect(note.raw).toBe(`${FM}**bold** first\n\nsecond line`);
  });

  test("a task checkbox toggles [ ] and [x] in the saved text", async ({ page, request }) => {
    const id = await open(page, request, "- [ ] one\n- [x] two\n\nend");
    const boxes = editorOf(page).getByRole("checkbox", { name: "Task" });
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await boxes.nth(0).click();
    await expect(boxes.nth(0)).toBeChecked();
    await boxes.nth(1).click();
    await expect(boxes.nth(1)).not.toBeChecked();
    expect(await saved(page, request, id)).toBe("- [x] one\n- [ ] two\n\nend");
  });

  test("the frontmatter is one line, Properties, that opens to the raw YAML when clicked or entered", async ({ page, request }) => {
    await open(page, request, "body");
    const editor = editorOf(page);
    await expect(editor.getByRole("button", { name: /Properties, 3 keys/ })).toHaveText("Properties (3)");
    await expect(editor).not.toContainText("owner: ana");
    await editor.getByRole("button", { name: /Properties/ }).click();
    await expect(editor).toContainText("owner: ana");
    await expect(editor.getByRole("button", { name: /Properties/ })).toHaveCount(0);
    await page.keyboard.press(end);
    await expect(editor.getByRole("button", { name: /Properties/ })).toBeVisible();
    // from the keyboard: the cursor going up into it opens it
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(editor).toContainText("owner: ana");
  });

  test("links show their text, and a wikilink with a type shows its target; a GitHub reference is a chip", async ({ page, request }) => {
    await open(page, request, "[the docs](https://example.com) and [[tech/glossary|related]] and [[gh:acme/app#12]]\n\nend");
    const editor = editorOf(page);
    await expect(editor.locator(".cm-lp-link")).toHaveText("the docs");
    await expect(editor.locator(".cm-lp-wikilink")).toHaveText("tech/glossary");
    await expect(editor.locator(".cm-lp-chip")).toHaveText("#12");
    await expect(editor).not.toContainText("https://example.com");
    await expect(editor).not.toContainText("|related");
  });

  test("the Markdown source toggle shows the raw text, and the choice survives a reload", async ({ page, request }) => {
    const id = await open(page, request, "**bold** text\n\nlast");
    const source = button(page, "Markdown source");
    await expect(source).toHaveAttribute("aria-pressed", "false");
    await expect(editorOf(page)).not.toContainText("**");
    await source.click();
    await expect(source).toHaveAttribute("aria-pressed", "true");
    await expect(editorOf(page)).toContainText("**bold** text");
    await expect(editorOf(page)).toContainText("owner: ana");
    await page.reload();
    await expect(button(page, "Markdown source")).toHaveAttribute("aria-pressed", "true");
    await expect(editorOf(page)).toContainText("**bold** text");
    expect(await page.evaluate(() => localStorage.getItem("dfl-live-preview"))).toBe("off");
    // and back
    await button(page, "Markdown source").click();
    await page.reload();
    await expect(button(page, "Markdown source")).toHaveAttribute("aria-pressed", "false");
    await editorOf(page).click();
    await page.keyboard.press(end);
    await expect(editorOf(page)).not.toContainText("**");
    expect(id).toContain("scratch/");
  });
});

test.describe("editing together with the toolbar", () => {
  test("formatting applied in one page shows up in the other, and the saved text is plain Markdown", async ({ browser, request }) => {
    const id = `scratch/ed-${rand()}`;
    expect((await request.post("/api/v1/notes", { headers: auth, data: { id, content: `${FM}shared` } })).ok()).toBe(true);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await signIn(a);
    const r = await request.post("/api/v1/tokens", { headers: auth, data: { name: "nadia", scopes: ["read", "write", "admin"], spaces: [] } });
    const { token } = (await r.json()) as { token: string };
    await b.goto(`/login/#token=${token}`);
    await expect(b.getByRole("heading", { name: "Defluance", level: 1 })).toBeVisible();

    await a.goto(`/n/${id}/?tab=edit`);
    await b.goto(`/n/${id}/?tab=edit`);
    await expect(a.getByText("Live", { exact: true })).toBeVisible();
    await expect(b.getByText("Live", { exact: true })).toBeVisible();

    await editorOf(a).click();
    await a.keyboard.press(end);
    await a.keyboard.press("Shift+Home");
    await button(a, "Bold").click();
    // B's cursor is on that line too, so the marks show, with A's cursor label inside
    await expect(editorOf(b).locator(".cm-lp-strong")).toContainText("shared");
    await expect(b.getByRole("button", { name: "Save" })).toBeEnabled();

    // the other person formats too: a heading on the same line, through the shared text
    await editorOf(b).click();
    await b.keyboard.press(end);
    await toolbarOf(b).getByRole("combobox", { name: "Heading" }).selectOption("2");
    await expect(editorOf(a).locator(".cm-lp-h2")).toHaveCount(1);

    await a.getByRole("button", { name: "Save" }).click();
    await expect(a.getByText(/Saved as commit/)).toBeVisible();
    const note = (await (await request.get(`/api/v1/notes/${encodeURIComponent(id)}`, { headers: auth })).json()) as { raw: string };
    expect(note.raw).toBe(`${FM}## **shared**`);
    await ctxA.close();
    await ctxB.close();
  });
});

/** Stub what the `@` popup asks. */
async function stubGithub(page: Page, status: { configured: boolean; defaultRepos?: string[]; publicRepos?: string[] }, items: object[] = []) {
  await page.route("**/api/v1/github/status", (route) => route.fulfill({ json: { repos: [], spaces: [], defaultRepos: [], webhookUrl: "http://x/webhooks/github", oauth: false, ...status } }));
  await page.route("**/api/v1/github/items?**", (route) => route.fulfill({ json: { items } }));
}

const ITEM = { key: "acme/app#12", kind: "pull-request", state: "open", title: "Fix password reset", labels: [], author: "nadia", url: "https://github.com/acme/app/pull/12" };

test.describe("the @ popup says why it is empty", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("GitHub configured but no repository linked: an admin gets a way to Settings", async ({ page, request }) => {
    await stubGithub(page, { configured: true });
    await open(page, request, "see ");
    await page.keyboard.type("@");
    const tip = page.locator(".cm-tooltip-autocomplete");
    await expect(tip).toContainText("No GitHub repository linked yet: link one in Settings > GitHub");
    await expect(tip).toContainText("Open Settings");
    await expectAccessible(page, "mention popup, no repository");
  });

  test("a person who is not an admin gets the text only", async ({ page, request }) => {
    await stubGithub(page, { configured: true });
    await page.route("**/api/v1/me", async (route) => {
      const res = await route.fetch();
      if (!res.ok()) return route.fulfill({ response: res }); // before sign-in the answer is a 401: pass it through
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, spaces: body.spaces.map((s: object) => ({ ...s, perms: ["read", "write"] })) } });
    });
    await open(page, request, "see ");
    await page.keyboard.type("@");
    const tip = page.locator(".cm-tooltip-autocomplete");
    await expect(tip).toContainText("No GitHub repository linked yet: link one in Settings > GitHub");
    await expect(tip).not.toContainText("Open Settings");
  });

  test("GitHub not connected", async ({ page, request }) => {
    await stubGithub(page, { configured: false });
    await open(page, request, "see ");
    await page.keyboard.type("@fix");
    await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("GitHub is not connected");
  });

  test("a repository is linked but nothing matches", async ({ page, request }) => {
    await stubGithub(page, { configured: true, defaultRepos: ["acme/app"] }, []);
    await open(page, request, "see ");
    await page.keyboard.type("@zzz");
    await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("No issue or pull request matches");
  });

  test("the toolbar GitHub button types the @ and opens the list; a hint explains @ and [[", async ({ page, request }) => {
    await stubGithub(page, { configured: true, defaultRepos: ["acme/app"] }, [ITEM]);
    const id = await open(page, request, "see");
    await expect(page.getByText("Type @ to mention an issue or pull request, [[ to link a note.")).toBeVisible();
    await button(page, "GitHub issue or pull request").click();
    await expect(page.getByRole("option", { name: /#12 Fix password reset/ })).toBeVisible();
    await page.waitForTimeout(300); // the list ignores Enter for a moment after it opens
    await page.keyboard.press("Enter");
    expect(await saved(page, request, id)).toBe("see [[gh:acme/app#12]]");
  });
});

test.describe("small screens and accessibility", () => {
  test("the toolbar wraps at 375px without a horizontal scroll", async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn(page);
    await open(page, request, "text");
    const tb = toolbarOf(page);
    await expect(tb).toBeVisible();
    const box = (await tb.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    // wrapped: the buttons sit on more than one row
    const rows = await tb.getByRole("button").evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(rows).toBeGreaterThan(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the editor with its toolbar, its link panel and some styled content is accessible", async ({ page, request }) => {
    await signIn(page);
    await open(page, request, "## Heading\n\n**bold** *it* ~~s~~ `c` [a](https://x.io) [[tech/glossary|related]] [[gh:acme/app#1]]\n\n- [ ] task\n- item\n\n> [!warning] Careful\n> body\n\n```js\nlet x = 1;\n```\n\n---\n\nend");
    await expectAccessible(page, "editor with toolbar");
    await button(page, "Link").click();
    await expectAccessible(page, "editor with the link panel");
    await button(page, "Markdown source").click();
    await expectAccessible(page, "editor in source mode");
  });
});

test.describe("linking a public repository in Settings", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  /** A stateful stub of the status and of PUT /github/repos, since the backend lands separately. */
  async function stubPublic(page: Page) {
    const state = { publicRepos: [] as string[], spaces: [{ name: "produit", repos: [] as string[] }], defaultRepos: [] as string[] };
    const puts: { repo: string; space?: string; linked: boolean; public?: boolean }[] = [];
    await page.route("**/api/v1/github/status", (route) => route.fulfill({ json: { configured: true, repos: [], ...state, webhookUrl: "http://x/webhooks/github", oauth: false } }));
    await page.route("**/api/v1/github/repos", (route) => {
      const body = route.request().postDataJSON() as { repo: string; space?: string; linked: boolean; public?: boolean };
      puts.push(body);
      if (body.repo === "acme/secret") return route.fulfill({ status: 422, contentType: "application/problem+json", json: { type: "about:blank", title: 'unknown or private repository "acme/secret"', status: 422 } });
      const list = body.space ? state.spaces.find((s) => s.name === body.space)?.repos : state.defaultRepos;
      if (body.linked) {
        list?.push(body.repo);
        state.publicRepos.push(body.repo);
      } else {
        for (const l of [list, state.publicRepos]) l?.splice(l.indexOf(body.repo), 1);
      }
      return route.fulfill({ json: { repo: body.repo, space: body.space ?? "default", linked: body.linked, changed: true, commit: "abc", public: true } });
    });
    return puts;
  }

  test("validates the input, accepts a pasted URL, links, lists with a badge, and unlinks", async ({ page }) => {
    const puts = await stubPublic(page);
    await page.goto("/settings/?tab=github");
    const form = page.getByRole("region", { name: "Link a public repository (read-only, no installation needed)" });
    const input = form.getByLabel("Repository: owner/name or a GitHub URL");
    const link = form.getByRole("button", { name: "Link", exact: true });
    await expect(link).toBeDisabled();
    await input.fill("not a repo");
    await expect(form.getByText("Enter owner/name, or a github.com address.")).toBeVisible();
    await expect(link).toBeDisabled();
    await expectAccessible(page, "public repository form with an error");

    await input.fill("https://github.com/acme/app/pulls");
    await expect(link).toBeEnabled();
    await form.getByLabel(/^Space for/).selectOption("produit");
    await link.click();
    await expect(page.getByText("acme/app linked. Syncing its issues and pull requests.")).toBeVisible();
    expect(puts).toEqual([{ repo: "acme/app", space: "produit", linked: true, public: true }]);
    const list = form.getByRole("list", { name: "Public repositories" });
    await expect(list.getByRole("listitem")).toContainText("acme/app");
    await expect(list.getByRole("listitem")).toContainText("Public, read-only");
    await expect(list.getByRole("listitem")).toContainText("Linked to produit");
    await expectAccessible(page, "public repository form with a linked repository");

    await list.getByRole("button", { name: "Unlink acme/app" }).click();
    await expect(list).toHaveCount(0);
    expect(puts.at(-1)).toEqual({ repo: "acme/app", space: "produit", linked: false });
  });

  test("a refused repository is explained inline", async ({ page }) => {
    await stubPublic(page);
    await page.goto("/settings/?tab=github");
    const form = page.getByRole("region", { name: "Link a public repository (read-only, no installation needed)" });
    await form.getByLabel("Repository: owner/name or a GitHub URL").fill("acme/secret");
    await form.getByRole("button", { name: "Link", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText('acme/secret: unknown or private repository "acme/secret"');
  });

  test("someone who is not an admin sees the list but no form", async ({ page }) => {
    await stubPublic(page);
    await page.route("**/api/v1/github/status", (route) => route.fulfill({ json: { configured: true, repos: [], spaces: [], defaultRepos: [], publicRepos: ["acme/app"], webhookUrl: "http://x/webhooks/github", oauth: false } }));
    await page.route("**/api/v1/me", async (route) => {
      const res = await route.fetch();
      if (!res.ok()) return route.fulfill({ response: res }); // before sign-in the answer is a 401: pass it through
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, spaces: body.spaces.map((s: object) => ({ ...s, perms: ["read"] })) } });
    });
    await page.goto("/settings/?tab=github");
    const form = page.getByRole("region", { name: "Link a public repository (read-only, no installation needed)" });
    await expect(form.getByRole("listitem")).toContainText("Public, read-only");
    await expect(form.getByLabel("Repository: owner/name or a GitHub URL")).toHaveCount(0);
    await expect(form.getByRole("button", { name: /Unlink/ })).toHaveCount(0);
  });
});

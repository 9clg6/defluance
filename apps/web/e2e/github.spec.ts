import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, signIn, TOKEN } from "./helpers";

const auth = { authorization: `Bearer ${TOKEN}` };
const rand = () => Math.random().toString(36).slice(2, 7);

const ITEMS = [
  { key: "acme/app#12", kind: "pull-request", state: "open", title: "Fix password reset", labels: [], author: "nadia", url: "https://github.com/acme/app/pull/12" },
  { key: "acme/app#14", kind: "issue", state: "closed", title: "Add CSV export", labels: [], author: "karim", url: "https://github.com/acme/app/issues/14" },
];

/** Stub the connector status and the items search. Returns the `items` requests the page made. */
async function stubGithub(page: Page, configured = true, linked = true) {
  const requests: URL[] = [];
  await page.route("**/api/v1/github/status", (route) => route.fulfill({ json: { configured, repos: [], spaces: [], defaultRepos: linked ? ["acme/app"] : [], webhookUrl: "http://x/webhooks/github", oauth: false } }));
  await page.route("**/api/v1/github/items?**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const kind = url.searchParams.get("kind");
    return route.fulfill({ json: { items: ITEMS.filter((i) => !kind || i.kind === kind) } });
  });
  return requests;
}

test.describe("@ mentions in the editor", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("@ lists issues and pull requests; @pr filters by kind; choosing inserts a wikilink", async ({ page }) => {
    const requests = await stubGithub(page);
    await page.goto("/n/tech/glossary/?tab=edit");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\nTracked in @");
    await expect(page.getByRole("option", { name: /#12 Fix password reset/ })).toContainText("PR · open · acme/app");
    await expect(page.getByRole("option", { name: /#14 Add CSV export/ })).toContainText("issue · closed · acme/app");
    expect(requests.at(-1)?.searchParams.get("kind")).toBeNull();

    await page.keyboard.type("pr ");
    await expect(page.getByRole("option", { name: /#14/ })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /#12/ })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("kind")).toBe("pull-request");
    await expectAccessible(page, "mention completion");

    await page.keyboard.press("Enter");
    await expect(editor).toContainText("Tracked in [[gh:acme/app#12]]");
    await expect(editor).not.toContainText("@pr");
  });

  test("a number finds that item, @issue filters to issues, and the | completion still offers link types", async ({ page }) => {
    const requests = await stubGithub(page);
    await page.goto("/n/tech/glossary/?tab=edit");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\n@issue 14");
    await expect(page.getByRole("option", { name: /#14 Add CSV export/ })).toBeVisible();
    const last = requests.at(-1)?.searchParams;
    expect([last?.get("kind"), last?.get("q")]).toEqual(["issue", "14"]);
    await page.keyboard.press("Enter");
    await expect(editor).toContainText("[[gh:acme/app#14]]");
    // Cursor is after the closing brackets, as for notes: step back in and type a bar.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("|trac");
    await expect(page.getByRole("option", { name: "tracked_by" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(editor).toContainText("[[gh:acme/app#14|tracked_by]]");
  });

  test("an email address does not open it, and when GitHub is not configured nothing is asked: the popup says so", async ({ page }) => {
    const requests = await stubGithub(page);
    await page.goto("/n/tech/glossary/?tab=edit");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\nWrite to ana@acme.io");
    await page.waitForTimeout(600);
    await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
    expect(requests).toHaveLength(0);

    const other = await page.context().newPage();
    const none = await stubGithub(other, false);
    await other.goto("/n/tech/glossary/?tab=edit");
    const ed = other.getByRole("textbox", { name: "Markdown editor" });
    await ed.click();
    await other.keyboard.press("Control+End");
    await other.keyboard.type("\n\nSee @");
    await expect(other.locator(".cm-tooltip-autocomplete")).toContainText("GitHub is not connected");
    expect(none).toHaveLength(0);
  });
});

test.describe("linking repositories in Settings", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  /** A stateful stub of the status and of PUT /github/repos. */
  async function stubRepos(page: Page) {
    const state = { spaces: [{ name: "produit", repos: ["acme/app"] }, { name: "tech", repos: [] as string[] }], defaultRepos: [] as string[] };
    const puts: { repo: string; space?: string; linked: boolean }[] = [];
    await page.route("**/api/v1/github/status", (route) =>
      route.fulfill({ json: { configured: true, repos: ["acme/app", "acme/web", "acme/denied"], ...state, webhookUrl: "http://x/webhooks/github", oauth: false } }),
    );
    await page.route("**/api/v1/github/repos", (route) => {
      const body = route.request().postDataJSON() as { repo: string; space?: string; linked: boolean };
      puts.push(body);
      if (body.repo === "acme/denied") return route.fulfill({ status: 422, contentType: "application/problem+json", json: { type: "about:blank", title: 'the GitHub App cannot see "acme/denied"', status: 422 } });
      const list = body.space ? state.spaces.find((s) => s.name === body.space)?.repos : state.defaultRepos;
      if (list) {
        const at = list.indexOf(body.repo);
        if (body.linked && at < 0) list.push(body.repo);
        if (!body.linked && at >= 0) list.splice(at, 1);
      }
      return route.fulfill({ json: { repo: body.repo, space: body.space ?? "default", linked: body.linked, changed: true, commit: "abc" } });
    });
    return puts;
  }

  test("an admin links a repository to a space, then unlinks it; a refusal is shown inline", async ({ page }) => {
    const puts = await stubRepos(page);
    await page.goto("/settings/?tab=github");
    const list = page.getByRole("region", { name: "Repositories the App can see" });
    const web = list.getByRole("listitem").filter({ hasText: "acme/web" });
    await expect(list.getByRole("listitem").filter({ hasText: "acme/app" })).toContainText("Linked to produit");
    await expect(web).toContainText("Not linked");
    await expectAccessible(page, "github repositories");

    await web.getByLabel("Space for acme/web").selectOption("tech");
    await web.getByRole("button", { name: "Link acme/web" }).click();
    await expect(page.getByText("acme/web linked. Syncing its issues and pull requests.")).toBeVisible();
    await expect(web).toContainText("Linked to tech");
    expect(puts).toEqual([{ repo: "acme/web", space: "tech", linked: true }]);

    await web.getByRole("button", { name: "Unlink acme/web" }).click();
    await expect(web).toContainText("Not linked");
    expect(puts.at(-1)).toEqual({ repo: "acme/web", space: "tech", linked: false });

    await list.getByRole("listitem").filter({ hasText: "acme/denied" }).getByRole("button", { name: "Link acme/denied" }).click();
    await expect(list.getByRole("alert")).toContainText('acme/denied: the GitHub App cannot see "acme/denied"');
    await expectAccessible(page, "github repositories with an error");
  });

  test("a repository can be linked to the default repositories (no space)", async ({ page }) => {
    const puts = await stubRepos(page);
    await page.goto("/settings/?tab=github");
    const web = page.getByRole("region", { name: "Repositories the App can see" }).getByRole("listitem").filter({ hasText: "acme/web" });
    await web.getByRole("button", { name: "Link acme/web" }).click();
    await expect(web).toContainText("Linked to default repositories");
    expect(puts).toEqual([{ repo: "acme/web", linked: true }]);
  });

  test("someone who is not an admin only reads", async ({ page }) => {
    await stubRepos(page);
    await page.route("**/api/v1/me", async (route) => {
      const res = await route.fetch();
      if (!res.ok()) return route.fulfill({ response: res }); // before sign-in the answer is a 401: pass it through
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, spaces: body.spaces.map((s: object) => ({ ...s, perms: ["read"] })) } });
    });
    await page.goto("/settings/?tab=github");
    await expect(page.getByRole("region", { name: "Repositories the App can see" }).getByRole("listitem").filter({ hasText: "acme/web" })).toContainText("Not linked");
    await expect(page.getByText("Only an admin can link repositories.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Link / })).toHaveCount(0);
    await expect(page.getByLabel("Space for acme/web")).toHaveCount(0);
  });
});

test.describe("GitHub references in a note", () => {
  test("a body link to an issue is a chip: unsynced it says so, synced it shows title and state; both open GitHub", async ({ page, request }) => {
    const id = `scratch/gh-${rand()}`;
    const content = `---\ntype: note\nstatus: draft\nowner: ana\n---\n# Gh refs\n\nTracked by [[gh:acme/app#12]] today.\n`;
    expect((await request.post("/api/v1/notes", { headers: auth, data: { id, content } })).ok()).toBe(true);
    await signIn(page);
    await page.goto(`/n/${id}/`);
    const chip = page.locator(".prose-note").getByRole("link", { name: /acme\/app#12/ });
    await expect(chip).toContainText("not synced");
    await expect(chip).toHaveAttribute("href", "https://github.com/acme/app/issues/12");
    await expect(chip).toHaveAttribute("target", "_blank");
    await expect(chip).toHaveAttribute("rel", /noopener/);
    await expect(page.locator("[title='Broken link: no such note']")).toHaveCount(0);

    await page.route(`**/api/v1/notes/${encodeURIComponent(id)}/links`, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      for (const l of body.outgoing.related ?? []) {
        l.github = { key: "acme/app#12", kind: "pull-request", state: "merged", title: "Fix password reset", labels: [], author: null, url: "https://github.com/acme/app/pull/12" };
      }
      await route.fulfill({ response: res, json: body });
    });
    await page.reload();
    const synced = page.locator(".prose-note").getByRole("link", { name: /acme\/app#12/ });
    await expect(synced).toContainText("Fix password reset");
    await expect(synced).toContainText("merged");
    await expect(synced).toHaveAttribute("href", "https://github.com/acme/app/pull/12");
    await expectAccessible(page, "note with a GitHub chip");
  });
});

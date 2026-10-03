import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, signIn } from "./helpers";

interface Tpl {
  name: string;
  source: "builtin" | "vault" | "override";
  content: string;
}

const BUILTIN: Record<string, string> = { adr: "# {{title}}\n\nBuilt-in ADR.\n", note: "# {{title}}\n" };

/** An in-memory stand-in for /api/v1/templates, with the rules the server applies (builtin / override / vault, 422 on unknown variables). */
async function stubTemplates(page: Page) {
  const items: Tpl[] = [
    { name: "adr", source: "builtin", content: BUILTIN["adr"]! },
    { name: "note", source: "builtin", content: BUILTIN["note"]! },
    { name: "runbook", source: "vault", content: "# {{title}}\n\nSteps.\n" },
  ];
  const calls: string[] = [];
  await page.route(/\/api\/v1\/templates(\/[^/?]+)?(\?.*)?$/, async (route) => {
    const req = route.request();
    const name = decodeURIComponent(new URL(req.url()).pathname.split("/")[4] ?? "");
    if (req.method() === "GET") return route.fulfill({ json: { items } });
    calls.push(`${req.method()} ${name}`);
    const at = items.findIndex((i) => i.name === name);
    if (req.method() === "PUT") {
      const { content } = req.postDataJSON() as { content: string };
      if (content.includes("{{foo}}")) return route.fulfill({ status: 422, json: { title: "Invalid template", errors: [{ message: "unknown variable {{foo}}" }] } });
      if (at >= 0) items[at] = { name, content, source: items[at]!.source === "builtin" ? "override" : items[at]!.source };
      else items.push({ name, content, source: "vault" });
      return route.fulfill({ json: { name, commit: "abcdef1234567" } });
    }
    if (at >= 0) {
      if (items[at]!.source === "override") items[at] = { name, source: "builtin", content: BUILTIN[name] ?? "" };
      else items.splice(at, 1);
    }
    return route.fulfill({ status: 204, body: "" });
  });
  return calls;
}

test.describe("templates settings", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("an administrator lists, edits, saves, reverts, creates and deletes", async ({ page }) => {
    const calls = await stubTemplates(page);
    await page.goto("/settings/?tab=templates");
    const list = page.getByRole("navigation", { name: "Templates" });
    await expect(list.getByRole("button", { name: /^adr\s*Built-in/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /^runbook\s*Custom/ })).toBeVisible();
    await expect(page.getByText("<!-- ai: guidance for this section -->")).toBeVisible();
    await expectAccessible(page, "templates");

    // edit a built-in one: it becomes Customised
    await list.getByRole("button", { name: /^adr/ }).click();
    const text = page.getByLabel("Template text");
    await expect(text).toHaveValue(BUILTIN["adr"]!);
    await expect(page.getByRole("button", { name: "Save template" })).toBeDisabled();
    await text.fill("# {{title}}\n\n<!-- ai: say what was decided -->\nMine.\n");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template saved (abcdef1)")).toBeVisible();
    await expect(list.getByRole("button", { name: /^adr\s*Customised/ })).toBeVisible();
    await expect(text).toContainText("Mine.");

    // server validation shows inline
    await text.fill("# {{foo}}");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "unknown variable {{foo}}" })).toBeVisible();

    // revert, with a confirmation
    await page.getByRole("button", { name: "Revert to built-in" }).click();
    const confirm = page.getByRole("dialog", { name: "Revert to the built-in template?" });
    await expectAccessible(page, "revert confirmation");
    await confirm.getByRole("button", { name: "Confirm" }).click();
    await expect(list.getByRole("button", { name: /^adr\s*Built-in/ })).toBeVisible();
    await expect(text).toHaveValue(BUILTIN["adr"]!);
    await expect(page.getByRole("button", { name: "Revert to built-in" })).toHaveCount(0);

    // a new template: the name is checked first
    const name = page.getByLabel("Name", { exact: true });
    await name.fill("Bad Name");
    await expect(page.getByText("Use lowercase letters, digits and hyphens")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create template" })).toBeDisabled();
    await name.fill("design-doc");
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(list.getByRole("button", { name: /^design-doc\s*Custom/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "design-doc" })).toBeVisible();

    // a custom one is deleted, not reverted
    await page.getByRole("button", { name: "Delete template" }).click();
    await page.getByRole("dialog", { name: "Delete this template?" }).getByRole("button", { name: "Confirm" }).click();
    await expect(list.getByRole("button", { name: /^design-doc/ })).toHaveCount(0);
    expect(calls).toEqual(["PUT adr", "PUT adr", "DELETE adr", "PUT design-doc", "DELETE design-doc"]);
  });

  test("someone who cannot administer reads the templates and cannot change them", async ({ page }) => {
    await stubTemplates(page);
    await page.route("**/api/v1/me", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, spaces: body.spaces.map((s: object) => ({ ...s, perms: ["read", "write"] })) } });
    });
    await page.goto("/settings/?tab=templates");
    await page.getByRole("button", { name: /^adr/ }).click();
    await expect(page.getByLabel("Template text")).toHaveAttribute("readonly", "");
    await expect(page.getByText("Only administrators can change templates.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save template" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create template" })).toHaveCount(0);
    await expectAccessible(page, "templates read-only");
  });
});

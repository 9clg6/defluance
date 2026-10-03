import { expect, test } from "@playwright/test";
import { expectAccessible, signIn, TOKEN } from "./helpers";

test.describe("connect an agent card", () => {
  test("an administrator gets the commands, with a placeholder instead of a token", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page);
    const card = page.getByRole("region", { name: "Connect an AI agent (MCP)" });
    await expect(card).toBeVisible();
    const url = `${new URL(page.url()).origin}/mcp`;
    const claude = `claude mcp add --transport http defluance ${url} --header "Authorization: Bearer <YOUR_TOKEN>"`;
    await expect(card.getByRole("tabpanel", { name: "Claude Code" }).locator("pre")).toHaveText(claude);
    await expectAccessible(page, "home with the MCP card");

    await card.getByRole("button", { name: "Copy Claude Code" }).click();
    await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(claude);

    await card.getByRole("tab", { name: "Cursor / Claude Desktop" }).click();
    const cursor = card.getByRole("tabpanel", { name: "Cursor / Claude Desktop" }).locator("pre");
    await expect(cursor).toContainText('"mcpServers"');
    expect(JSON.parse((await cursor.textContent()) ?? "")).toEqual({ mcpServers: { defluance: { url, headers: { Authorization: "Bearer <YOUR_TOKEN>" } } } });
    await card.getByRole("tab", { name: "Local folder (stdio)" }).click();
    await expect(card.getByRole("tabpanel", { name: "Local folder (stdio)" }).locator("pre")).toHaveText("claude mcp add defluance -- npx defluance mcp ./my-notes");

    await expect(card.getByRole("link", { name: "Settings → API tokens" })).toHaveAttribute("href", "/settings/?tab=tokens");
    await expect(card.getByRole("link", { name: "Drafts" })).toHaveAttribute("href", "/drafts/");
    expect(await card.innerText()).not.toContain(TOKEN);
  });

  test("a person who cannot create tokens does not see it", async ({ page }) => {
    await page.route("**/api/v1/me", async (route) => {
      const res = await route.fetch();
      if (!res.ok()) return route.fulfill({ response: res }); // before sign-in the answer is a 401: pass it through
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, spaces: body.spaces.map((s: object) => ({ ...s, perms: ["read", "write"] })) } });
    });
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Waiting for review" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect an AI agent (MCP)" })).toHaveCount(0);
  });
});

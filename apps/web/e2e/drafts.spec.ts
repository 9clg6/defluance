import { expect, test, type APIRequestContext } from "@playwright/test";
import { expectAccessible, signIn, TOKEN } from "./helpers";

const auth = { authorization: `Bearer ${TOKEN}` };

/** An agent saves a note: its version lands on a branch, not on the main branch. */
async function agentDraft(request: APIRequestContext, id: string, line: string) {
  const made = await request.post("/api/v1/tokens", { headers: auth, data: { name: `agent-${Math.random().toString(36).slice(2, 6)}`, scopes: ["read", "write"], spaces: [] } });
  const agent = ((await made.json()) as { token: string }).token;
  const path = `/api/v1/notes/${encodeURIComponent(id)}`;
  const cur = (await (await request.get(path, { headers: auth })).json()) as { raw: string; commit: string };
  const w = await request.put(path, { headers: { authorization: `Bearer ${agent}` }, data: { content: `${cur.raw}\n${line}\n`, base_commit: cur.commit } });
  expect(w.status()).toBe(200);
  return ((await w.json()) as { branch: string }).branch;
}

test.describe("drafts from agents", () => {
  test.describe.configure({ mode: "serial" });

  test("an agent's draft is reviewed as a diff and merged by a person", async ({ page, request }) => {
    await agentDraft(request, "tech/webhooks", "Retries wait one minute, then ten.");
    await signIn(page);
    await page.goto("/drafts/");
    await expect(page.getByRole("heading", { name: "Drafts from agents", level: 1 })).toBeVisible();
    const card = page.getByRole("listitem").filter({ hasText: "tech/webhooks" });
    await expect(card.getByText("Merges cleanly")).toBeVisible();
    await card.getByRole("button", { name: /Review/ }).click();

    const table = page.getByRole("table", { name: "What it changes: tech/webhooks.md" });
    await expect(table).toContainText("Retries wait one minute, then ten.");
    await expectAccessible(page, "draft review");

    await page.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByText("Merged into the main branch")).toBeVisible();
    await expect(page.getByText("No draft waiting")).toBeVisible();

    await page.goto("/n/tech/webhooks/");
    await expect(page.getByText("Retries wait one minute, then ten.")).toBeVisible();
  });

  test("a draft that conflicts with a later change cannot be merged, and can be discarded", async ({ page, request }) => {
    const branch = await agentDraft(request, "tech/rate-limiting", "Agent: limits are per token.");
    const path = "/api/v1/notes/tech%2Frate-limiting";
    const cur = (await (await request.get(path, { headers: auth })).json()) as { raw: string; commit: string };
    const lines = cur.raw.split("\n");
    lines[lines.length - 2] = "Human: limits are per user.";
    expect((await request.put(path, { headers: auth, data: { content: lines.join("\n"), base_commit: cur.commit } })).status()).toBe(200);

    await signIn(page);
    await page.goto(`/drafts/?branch=${encodeURIComponent(branch)}`);
    const card = page.getByRole("listitem").filter({ hasText: "tech/rate-limiting" });
    await expect(card.getByText("Conflicts with later changes")).toBeVisible();
    await expect(page.getByRole("button", { name: "Merge", exact: true })).toBeDisabled();

    await page.getByRole("button", { name: "Discard", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Discard this draft?" });
    await dialog.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByText("Draft discarded")).toBeVisible();
    await expect(page.getByText("No draft waiting")).toBeVisible();
    const kept = (await (await request.get(path, { headers: auth })).json()) as { raw: string };
    expect(kept.raw).toContain("Human: limits are per user.");
  });
});

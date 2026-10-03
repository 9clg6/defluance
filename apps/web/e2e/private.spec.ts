import { expect, test } from "@playwright/test";
import { expectAccessible, signIn } from "./helpers";

const PASS = "an e2e passphrase for tests";
const MARKER = "ZEBRAFISH-SECRET-42";

test.describe.configure({ mode: "serial" });

/** The key may already be unlocked by an earlier test of the run: unlock it only if it is locked. */
async function ensureUnlocked(page: import("@playwright/test").Page) {
  await page.goto("/settings/?tab=private");
  const card = page.getByRole("listitem").filter({ hasText: "E2E key" });
  await expect(card.getByText(/^(Locked|Unlocked)$/)).toBeVisible();
  if (await card.getByText("Locked", { exact: true }).isVisible()) {
    await card.getByLabel(/^Passphrase/).fill(PASS);
    await card.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(card.getByText("Unlocked", { exact: true })).toBeVisible();
}

test.describe("private notes", () => {
  test("creates a key, shows it locked, and unlocks it with the passphrase", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings/?tab=private");
    await expect(page.getByText("You have no key yet.")).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("E2E key");
    await page.getByLabel("Passphrase", { exact: true }).fill(PASS);
    await page.getByLabel("Passphrase (2)", { exact: true }).fill(PASS);
    await page.getByRole("button", { name: "Create key" }).click();
    const card = page.getByRole("listitem").filter({ hasText: "E2E key" });
    await expect(card.getByText("Locked")).toBeVisible();
    await expectAccessible(page, "private notes settings");

    await card.getByLabel(/^Passphrase/).fill("not the passphrase at all");
    await card.getByRole("button", { name: "Unlock" }).click();
    await expect(card.getByRole("alert")).toBeVisible();

    await card.getByLabel(/^Passphrase/).fill(PASS);
    await card.getByRole("button", { name: "Unlock" }).click();
    await expect(card.getByText("Unlocked")).toBeVisible();
    await expect(card.getByText(/locks at/)).toBeVisible();
  });

  test("writes a private note, locks it, and reads it again after unlocking", async ({ page }) => {
    await signIn(page);
    await ensureUnlocked(page);

    await page.goto("/");
    await page.getByRole("button", { name: "New note" }).click();
    const dialog = page.getByRole("dialog", { name: "New note" });
    await dialog.getByLabel("Title").fill("Board minutes");
    await dialog.getByLabel("Folder").fill("produit");
    await dialog.getByLabel("Private note (encrypted)").check();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/produit\/board-minutes\/?\?tab=edit/);
    await expect(page.getByText("Private", { exact: true }).first()).toBeVisible();

    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
    await page.keyboard.type(`\n\nThe board approved ${MARKER} on Monday.`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved as commit/)).toBeVisible();
    await expect(page.getByText(MARKER).first()).toBeVisible();

    // it is found by its words while the key is unlocked
    await page.goto(`/search/?q=${encodeURIComponent("board approved")}`);
    const hit = page.getByRole("article").filter({ hasText: "Board minutes" });
    await expect(hit).toBeVisible();
    await expect(hit.getByText("Private", { exact: true })).toBeVisible();

    // lock: the text is gone from the page, and so is the hit
    await page.goto("/n/produit/board-minutes/");
    await page.getByRole("button", { name: "Lock my keys" }).click();
    await expect(page.getByRole("heading", { name: "This note is private" })).toBeVisible();
    await expect(page.getByText(MARKER)).toHaveCount(0);
    await expectAccessible(page, "locked private note");
    await page.goto(`/search/?q=${encodeURIComponent("board approved")}`);
    await expect(page.getByText("No note matches.", { exact: false })).toBeVisible();

    // unlock from the note itself
    await page.goto("/n/produit/board-minutes/");
    await page.getByLabel(/^Passphrase/).fill(PASS);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText(MARKER).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who can read it" })).toBeVisible();
    await expectAccessible(page, "unlocked private note");
  });

  test("encrypts a plain note, and says what stays in the history", async ({ page }) => {
    await signIn(page);
    await ensureUnlocked(page);
    await page.goto("/n/tech/glossary/");
    await page.getByRole("button", { name: "Encrypt this note" }).click();
    const dialog = page.getByRole("dialog", { name: "Encrypt this note" });
    await expect(dialog.getByText("Earlier versions stay readable in the git history", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: "Encrypt", exact: true }).click();
    await expect(page.getByText("Note encrypted")).toBeVisible();
    await expect(page.getByText("Private", { exact: true }).first()).toBeVisible();
  });
});

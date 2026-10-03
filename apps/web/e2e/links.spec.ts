import { expect, test } from "@playwright/test";
import { expectAccessible, signIn } from "./helpers";

test.describe("adding a link", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("pick a note and a type: the link appears in the panel", async ({ page }) => {
    await page.goto("/n/produit/billing-invoices/");
    await page.getByRole("button", { name: /^Links \(/ }).click();
    await page.getByRole("button", { name: "Add link" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a link" });
    await dialog.getByLabel("Linked note").fill("gloss");
    await dialog.getByRole("list", { name: "Matching notes" }).getByRole("button", { name: /Glossary/ }).click();
    await expect(dialog.getByLabel("Linked note")).toHaveValue("tech/glossary");
    await dialog.getByLabel("Link type").selectOption("related");
    await expectAccessible(page, "add link dialog");
    await dialog.getByRole("button", { name: "Add link" }).click();
    await expect(page.getByText("Link added")).toBeVisible();
    await page.getByRole("button", { name: /^Links \(/ }).click();
    await expect(page.getByRole("region", { name: "Links from this note" }).getByRole("link", { name: "Glossary" })).toBeVisible();
  });

  test("a refused link is explained in the dialog", async ({ page }) => {
    await page.goto("/n/produit/billing-invoices/");
    await page.getByRole("button", { name: /^Links \(/ }).click();
    await page.getByRole("button", { name: "Add link" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a link" });
    await dialog.getByLabel("Linked note").fill("no/such-note");
    await dialog.getByRole("button", { name: "Add link" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

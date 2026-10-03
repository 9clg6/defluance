import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const animations = (page: import("@playwright/test").Page, selector: string) =>
  page.evaluate((sel) => document.querySelector(sel)?.getAnimations().map((a) => ({ name: (a as CSSAnimation).animationName, ms: Number(a.effect?.getTiming().duration) })) ?? null, selector);

test.describe("dialog motion", () => {
  test("a dialog scales and fades in, and fades out before it leaves the page", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "New note" }).click();
    const dialog = page.getByRole("dialog", { name: "New note" });
    await expect(dialog).toBeVisible();
    expect(await animations(page, "[data-dialog-content]")).toEqual([{ name: "dfl-modal-in", ms: 250 }]);
    expect(await animations(page, "[data-dialog-overlay]")).toEqual([{ name: "dfl-fade-in", ms: 250 }]);

    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    // still mounted while the exit animation runs, then gone
    expect(await animations(page, "[data-dialog-content]")).toEqual([{ name: "dfl-modal-out", ms: 150 }]);
    await expect(dialog).toHaveCount(0);
  });

  test("with reduced motion the dialog still opens and closes, without a visible animation", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: "http://127.0.0.1:4010" });
    const page = await ctx.newPage();
    await signIn(page);
    await page.getByRole("button", { name: "New note" }).click();
    await expect(page.getByRole("dialog", { name: "New note" })).toBeVisible();
    const open = await animations(page, "[data-dialog-content]");
    for (const a of open ?? []) expect(a.ms).toBeLessThan(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await ctx.close();
  });
});

import { expect, test, type Page } from "@playwright/test";
import { PORT } from "../playwright.config";
import { signIn } from "./helpers";

/** Opacity and transform of the open dialog, once per frame for 700 ms. Must be started before the click. */
const sampleDialog = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ opacity: number; transform: string }[]>((done) => {
        const out: { opacity: number; transform: string }[] = [];
        const t0 = performance.now();
        const tick = () => {
          const d = document.querySelector('[role="dialog"]');
          if (d) {
            const s = getComputedStyle(d);
            out.push({ opacity: Number(s.opacity), transform: s.transform });
          }
          if (performance.now() - t0 < 700) requestAnimationFrame(tick);
          else done(out);
        };
        tick();
      }),
  );

const moved = (t: string) => t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)";

test.describe("dialog motion", () => {
  test("a dialog fades in while it scales up, then rests, and leaves when closed", async ({ page }) => {
    await signIn(page);
    const sampled = sampleDialog(page);
    await page.getByRole("button", { name: "New note" }).click();
    const dialog = page.getByRole("dialog", { name: "New note" });
    await expect(dialog).toBeVisible();
    const frames = await sampled;
    expect(frames.length).toBeGreaterThan(5);
    expect(Math.min(...frames.map((f) => f.opacity))).toBeLessThan(0.9); // it starts faded
    expect(frames.some((f) => moved(f.transform))).toBe(true); // and scaled
    expect(frames.at(-1)).toMatchObject({ opacity: 1 }); // and ends at rest
    expect(moved(frames.at(-1)?.transform ?? "none")).toBe(false);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("with reduced motion the dialog fades but does not scale or slide", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: `http://127.0.0.1:${PORT}` });
    const page = await ctx.newPage();
    await signIn(page);
    const sampled = sampleDialog(page);
    await page.getByRole("button", { name: "New note" }).click();
    await expect(page.getByRole("dialog", { name: "New note" })).toBeVisible();
    const frames = await sampled;
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((f) => moved(f.transform))).toBe(false);
    expect(frames.at(-1)).toMatchObject({ opacity: 1 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await ctx.close();
  });
});

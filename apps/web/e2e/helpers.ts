import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const TOKEN = "dfl_e2e_token_for_tests";

export async function signIn(page: Page) {
  await page.goto(`/login/#token=${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Defluance", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
}

/** Fails on serious or critical WCAG violations. The canvas of the graph is covered by its list alternative. */
export async function expectAccessible(page: Page, label: string) {
  // Arc text swaps (a badge going from "Connecting…" to "Live") leave the outgoing copy half faded for a moment: wait for it.
  await page.waitForFunction(() => !document.querySelector("[data-motion-pop-id]"));
  // Colour transitions would make axe sample half-way colours right after a theme switch.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  // Arc components fade in with script-driven animations (toast, timeline, date picker): let them settle, or axe samples a half-faded colour.
  await page.waitForTimeout(600);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")})`), `accessibility of ${label}`).toEqual([]);
}

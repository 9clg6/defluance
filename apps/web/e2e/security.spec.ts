import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("browser security policy", () => {
  test("every page works under the Content-Security-Policy, with no violation", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (/content security policy|refused to (load|execute|apply|connect)/i.test(m.text())) problems.push(m.text());
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

    await signIn(page);
    for (const path of ["/", "/search/?q=login", "/graph/", "/audit/", "/settings/", "/n/produit/auth-login/"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    // The note carries a mermaid diagram: rendering it injects inline styles and SVG.
    await expect(page.getByRole("img", { name: "Diagram" }).locator("svg")).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("the server answers with the policy and refuses framing", async ({ request }) => {
    const res = await request.get("/");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["x-request-id"]).toBeTruthy();
  });
});

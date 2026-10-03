import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectAccessible, signIn, TOKEN } from "./helpers";

const auth = { authorization: `Bearer ${TOKEN}` };
const rand = () => Math.random().toString(36).slice(2, 7);
const end = () => (process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
const editorOf = (page: Page) => page.getByRole("textbox", { name: "Markdown editor" });
const previewButton = (page: Page) => page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Preview", exact: true });
const sourceButton = (page: Page) => page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Markdown source", exact: true });
const previewPane = (page: Page) => page.getByRole("heading", { name: "Preview", level: 2 });
const divider = (page: Page) => page.getByRole("separator", { name: "Resize editor and preview" });

/** A scratch note, so that changing its status or text touches no fixture. */
async function scratch(request: APIRequestContext): Promise<string> {
  const id = `scratch/lay-${rand()}`;
  const content = `---\ntype: note\nstatus: draft\nowner: ana\n---\n# Layout\n\nSome text to read and to edit.\n`;
  expect((await request.post("/api/v1/notes", { headers: auth, data: { id, content } })).ok()).toBe(true);
  return id;
}

async function width(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  return box?.width ?? 0;
}

test.describe("note page layout", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("at 1440px the editor has the page and there is no right column", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await scratch(request);
    await page.goto(`/n/${id}/?tab=edit`);
    await expect(editorOf(page)).toBeVisible();
    await expect(previewPane(page)).toHaveCount(0);
    await expect(page.locator("aside")).toHaveCount(0);
    const editor = (await editorOf(page).boundingBox())?.width ?? 0;
    console.log(`editor width at 1440px, edit tab, preview off: ${editor}px`);
    expect(editor).toBeGreaterThanOrEqual(900);

    await page.goto(`/n/${id}/`);
    await expect(page.getByRole("heading", { name: "Layout", level: 1 })).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(0);
    const prose = await width(page, ".prose-note");
    console.log(`read tab, text column at 1440px: ${prose}px`);
    expect(prose).toBeGreaterThan(600);
    expect(prose).toBeLessThanOrEqual(52 * 16 + 1);
  });

  test("the chips: status, rename, links and properties, with focus coming back", async ({ page, request }) => {
    const id = await scratch(request);
    await page.goto(`/n/${id}/`);
    const actions = page.getByRole("group", { name: "Actions" });
    for (const name of ["Rename or move", "Delete", "Encrypt this note", "Open GitHub issue"]) await expect(actions.getByRole("button", { name })).toBeVisible();

    await page.getByLabel("Status").selectOption("review");
    await expect(page.getByText("Status is now review")).toBeVisible();

    await actions.getByRole("button", { name: "Rename or move" }).click();
    await expect(page.getByRole("dialog", { name: "Rename or move this note" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const links = actions.getByRole("button", { name: /^Links \(/ });
    await links.click();
    const panel = page.getByRole("dialog", { name: /^Links \(/ });
    await expect(panel.getByRole("heading", { name: "Links from this note" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Linked from" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Add link" })).toBeVisible();
    await expectAccessible(page, "links popover");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(links).toBeFocused();

    const props = actions.getByRole("button", { name: "Properties" });
    await props.click();
    const table = page.getByRole("dialog", { name: "Properties" });
    await expect(table.getByText("owner")).toBeVisible();
    await expect(table.getByText("ana")).toBeVisible();
    await expectAccessible(page, "properties popover");
    await page.keyboard.press("Escape");
    await expect(table).toHaveCount(0);
    await expect(props).toBeFocused();
  });

  test("the note page is accessible in the read and edit tabs", async ({ page, request }) => {
    const id = await scratch(request);
    await page.goto(`/n/${id}/`);
    await expect(page.getByRole("heading", { name: "Layout", level: 1 })).toBeVisible();
    await expectAccessible(page, "note, read tab");
    await page.goto(`/n/${id}/?tab=edit`);
    await expect(editorOf(page)).toBeVisible();
    await expectAccessible(page, "note, edit tab");
    await previewButton(page).click();
    await expect(divider(page)).toBeVisible();
    await expectAccessible(page, "note, edit tab with the preview and its divider");
  });

  test("the Preview button: off with live preview, on with Markdown source, remembered", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await scratch(request);
    await page.goto(`/n/${id}/?tab=edit`);
    await expect(editorOf(page)).toBeVisible();
    await expect(previewButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(previewPane(page)).toHaveCount(0);

    await previewButton(page).click();
    await expect(previewButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(previewPane(page)).toBeVisible();
    await page.reload();
    await expect(previewButton(page)).toHaveAttribute("aria-pressed", "true");
    await previewButton(page).click();
    await expect(previewPane(page)).toHaveCount(0);
    await page.reload();
    await expect(previewButton(page)).toHaveAttribute("aria-pressed", "false");

    // Without a choice of its own, the preview follows Markdown source: raw text, the result beside it.
    await page.evaluate(() => localStorage.removeItem("dfl-side-preview"));
    await page.reload();
    await expect(previewButton(page)).toHaveAttribute("aria-pressed", "false");
    await sourceButton(page).click();
    await expect(previewButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(previewPane(page)).toBeVisible();
    await page.reload();
    await expect(sourceButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(previewPane(page)).toBeVisible();
    await previewButton(page).click();
    await page.reload();
    await expect(previewPane(page)).toHaveCount(0);
  });

  test("the divider moves with the mouse and the keyboard, and the width is remembered", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await scratch(request);
    await page.goto(`/n/${id}/?tab=edit`);
    await expect(editorOf(page)).toBeVisible();
    await previewButton(page).click();
    const sep = divider(page);
    await expect(sep).toHaveAttribute("aria-orientation", "vertical");
    await expect(sep).toHaveAttribute("aria-valuemin", "25");
    await expect(sep).toHaveAttribute("aria-valuemax", "75");
    await expect(sep).toHaveAttribute("aria-valuenow", "50");

    const box = (await sep.boundingBox())!;
    const wrap = (await page.locator("[style*='--split']").first().boundingBox())!;
    const y = box.y + 40;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(wrap.x + wrap.width * 0.65, y, { steps: 6 });
    await page.mouse.up();
    const dragged = Number(await sep.getAttribute("aria-valuenow"));
    expect(dragged).toBeGreaterThan(60);
    expect(dragged).toBeLessThan(70);

    // not past the minimum
    await page.mouse.move((await sep.boundingBox())!.x + 8, y);
    await page.mouse.down();
    await page.mouse.move(wrap.x + 5, y, { steps: 6 });
    await page.mouse.up();
    await expect(sep).toHaveAttribute("aria-valuenow", "25");

    await sep.focus();
    await page.keyboard.press("ArrowRight");
    await expect(sep).toHaveAttribute("aria-valuenow", "27");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(sep).toHaveAttribute("aria-valuenow", "25");
    await page.keyboard.press("End");
    await expect(sep).toHaveAttribute("aria-valuenow", "75");
    await page.keyboard.press("Home");
    await expect(sep).toHaveAttribute("aria-valuenow", "25");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(sep).toHaveAttribute("aria-valuenow", "31");
    const narrow = (await editorOf(page).boundingBox())!.width;

    await page.reload();
    await expect(editorOf(page)).toBeVisible();
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "31");
    expect((await editorOf(page).boundingBox())!.width).toBeCloseTo(narrow, -1);

    await divider(page).dblclick();
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "50");
  });

  test("the editor is not remounted when the preview is toggled", async ({ page, request }) => {
    const id = await scratch(request);
    await page.goto(`/n/${id}/?tab=edit`);
    await expect(editorOf(page)).toBeVisible();
    await editorOf(page).evaluate((el) => ((el as HTMLElement & { __mark?: boolean }).__mark = true));
    await previewButton(page).click();
    await expect(previewPane(page)).toBeVisible();
    await previewButton(page).click();
    await expect(previewPane(page)).toHaveCount(0);
    expect(await editorOf(page).evaluate((el) => (el as HTMLElement & { __mark?: boolean }).__mark)).toBe(true);
  });

  test("at 375px nothing scrolls sideways and chips are icons; at 768px the preview stacks", async ({ page, request }) => {
    const id = await scratch(request);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/n/${id}/`);
    await expect(page.getByRole("heading", { name: "Layout", level: 1 })).toBeVisible();
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await noScroll()).toBe(true);
    // labels give way to icons, names stay
    await expect(page.getByRole("button", { name: "Rename or move" })).toBeVisible();
    expect((await page.getByRole("button", { name: "Rename or move" }).boundingBox())!.width).toBeLessThan(60);
    await page.goto(`/n/${id}/?tab=edit`);
    await expect(editorOf(page)).toBeVisible();
    await previewButton(page).click();
    await expect(previewPane(page)).toBeVisible();
    await expect(divider(page)).toBeHidden();
    expect(await noScroll()).toBe(true);
    await expectAccessible(page, "note at 375px");

    await page.setViewportSize({ width: 768, height: 900 });
    await expect(divider(page)).toBeHidden();
    const e = (await editorOf(page).boundingBox())!;
    const p = (await previewPane(page).boundingBox())!;
    expect(p.y).toBeGreaterThan(e.y + e.height - 1);
    expect(await noScroll()).toBe(true);
    await expect(page.getByRole("button", { name: "Rename or move" })).toContainText("Rename or move");
  });
});

async function second(page: Page, request: APIRequestContext, name: string) {
  const r = await request.post("/api/v1/tokens", { headers: auth, data: { name, scopes: ["read", "write", "admin"], spaces: [] } });
  const { token } = (await r.json()) as { token: string };
  await page.goto(`/login/#token=${token}`);
  await expect(page.getByRole("heading", { name: "Defluance", level: 1 })).toBeVisible();
}

test("live editing keeps working while the preview is toggled and the divider moves", async ({ browser, request }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a);
  await second(b, request, "lena");
  const id = await scratch(request);
  await a.goto(`/n/${id}/?tab=edit`);
  await b.goto(`/n/${id}/?tab=edit`);
  await expect(a.getByText("Live", { exact: true })).toBeVisible();
  await expect(b.getByText("Live", { exact: true })).toBeVisible();

  await previewButton(a).click();
  await expect(previewPane(a)).toBeVisible();
  await editorOf(b).click();
  await b.keyboard.press(end());
  await b.keyboard.type("\n\nFrom the second person.");
  await expect(editorOf(a)).toContainText("From the second person.");
  await expect(a.locator(".prose-note").filter({ hasText: "From the second person." })).toBeVisible();

  await divider(a).focus();
  await a.keyboard.press("ArrowRight");
  await previewButton(a).click();
  await expect(previewPane(a)).toHaveCount(0);
  await editorOf(a).click();
  await a.keyboard.press(end());
  await a.keyboard.type("\n\nFrom the first.");
  await expect(editorOf(b)).toContainText("From the first.");
  await expect(editorOf(a)).toContainText("From the second person.");
});

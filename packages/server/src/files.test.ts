import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeServer, type TestServer } from "./test-env.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let s: TestServer;
beforeAll(async () => void (s = await makeServer()));
afterAll(async () => s.cleanup());

const upload = (note: string, name: string, data: Buffer | Uint8Array, token: string | null = s.admin) => {
  const form = new FormData();
  form.set("note", note);
  form.set("file", new File([data as BlobPart], name));
  return s.request("/api/v1/files", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
};
const get = (path: string, token: string | null = s.admin) => s.request(`/api/v1/files/${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("attachments", () => {
  let path: string;

  it("stores a picture next to its note in one commit, and serves it back", async () => {
    const r = await upload("produit/auth-login", "Login Flow.PNG", PNG);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.ref).toMatch(/^attachments\/login-flow-[0-9a-f]{8}\.png$/);
    expect(body.markdown).toBe(`![[${body.ref}]]`);
    path = body.path;
    expect(path).toBe(`produit/${body.ref}`);
    expect(s.git("log", "--format=%s", "-1").trim()).toBe(`add attachment ${path.split("/").at(-1)}`);

    const img = await get(path);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toContain("sandbox");
    expect(img.headers.get("cache-control")).toBe("private, max-age=300");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("stores the same file once", async () => {
    const before = s.git("rev-list", "--count", "HEAD").trim();
    const again = await upload("produit/auth-login", "login flow.png", PNG);
    expect(again.status).toBe(200);
    expect((await again.json()).existed).toBe(true);
    expect(s.git("rev-list", "--count", "HEAD").trim()).toBe(before);
    // a different picture with the same name is a different file
    const other = Buffer.concat([PNG, Buffer.from([0])]);
    expect((await (await upload("produit/auth-login", "login flow.png", other)).json()).ref).not.toMatch(/login-flow-[0-9a-f]{8}\.png/u.exec(path) ? new RegExp(path.split("/").at(-1) as string) : /x^/);
  });

  it("refuses what is not what it says, what is empty, too large, or not a picture", async () => {
    expect((await upload("produit/auth-login", "evil.png", Buffer.from("<script>alert(1)</script>"))).status).toBe(415);
    expect((await upload("produit/auth-login", "tool.exe", Buffer.from("MZ"))).status).toBe(415);
    expect((await upload("produit/auth-login", "page.html", Buffer.from("<p>"))).status).toBe(415);
    expect((await upload("produit/auth-login", "empty.png", Buffer.alloc(0))).status).toBe(422);
    expect((await upload("produit/auth-login", "big.png", Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]))).status).toBe(413);
    expect((await upload("produit/does-not-exist", "a.png", PNG)).status).toBe(404);
    const form = new FormData();
    form.set("note", "produit/auth-login");
    expect((await s.request("/api/v1/files", { method: "POST", headers: { authorization: `Bearer ${s.admin}` }, body: form })).status).toBe(422);
  });

  it("follows the space rules: readers and agents cannot upload, outsiders cannot see", async () => {
    const reader = await s.token(["read"]);
    expect((await upload("produit/auth-login", "r.png", PNG, reader)).status).toBe(403);
    const agent = await s.token(["read", "write"]);
    expect((await upload("produit/auth-login", "a.png", PNG, agent)).status).toBe(403);
    const elsewhere = await s.token(["read", "write", "admin"], ["tech"]);
    expect((await upload("produit/auth-login", "e.png", PNG, elsewhere)).status).toBe(404);
    expect((await get(path, elsewhere)).status).toBe(404);
    expect((await get(path, null)).status).toBe(401);
    expect((await get(path, reader)).status).toBe(200);
  });

  it("serves media only: no notes, no dotfiles, no way out of the vault", async () => {
    expect((await get("produit/auth-login.md")).status).toBe(415);
    expect((await get(".git/config")).status).toBe(400);
    expect((await get(".defluance/keys/x.json")).status).toBe(400);
    // dots in any spelling are resolved away by the URL parser before routing: the request never reaches a file
    expect((await get("produit/../../etc/passwd.png")).status).toBe(404);
    expect((await get("produit/%2e%2e/%2e%2e/etc/passwd.png")).status).toBe(404);
    expect((await get("produit%5C..%5Cauth-login.png")).status).toBe(400); // a backslash is refused outright
    expect((await get("produit/nothing.png")).status).toBe(404);
    await writeFile(join(s.root, "produit", "notes.sh"), "echo hi");
    expect((await get("produit/notes.sh")).status).toBe(415);
  });

  it("serves an SVG in a sandbox and a PDF inline", async () => {
    await writeFile(join(s.root, "produit", "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await writeFile(join(s.root, "produit", "spec.pdf"), "%PDF-1.4 test");
    const svg = await get("produit/logo.svg");
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    const pdf = await get("produit/spec.pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(/^inline/);
    const csv = await (async () => { await writeFile(join(s.root, "produit", "data.csv"), "a,b"); return get("produit/data.csv"); })();
    expect(csv.headers.get("content-disposition")).toMatch(/^attachment/);
  });
});

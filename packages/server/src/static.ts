import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a request path inside the exported UI. Note pages are client-rendered:
 * `/n/anything` is served by `/n/index.html`, which reads the id from the URL.
 */
export async function resolveStatic(uiDir: string, urlPath: string): Promise<{ file: string; type: string } | null> {
  let p: string;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const rel = normalize(p).replace(/^([/\\])+/, "");
  if (rel.split(sep).includes("..")) return null;
  const candidates = [rel, join(rel, "index.html"), `${rel}.html`];
  const first = p.split("/").filter(Boolean)[0];
  if (first === "n") candidates.push(join("n", "index.html"));
  for (const c of candidates) {
    const file = join(uiDir, c);
    if (file.startsWith(uiDir) && (await isFile(file))) return { file, type: TYPES[extname(file)] ?? "application/octet-stream" };
  }
  return null;
}

export async function readStatic(file: string): Promise<Buffer> {
  return readFile(file);
}

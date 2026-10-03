import { EditorState } from "@codemirror/state";
import type { CompletionContext } from "@codemirror/autocomplete";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EN_LABELS } from "@/lib/mention";
import { mentionSource, resetGithubCache, wikilinkSource } from "./Editor";

/** A completion context at the end of `doc`, enough for the two sources. */
function at(doc: string): CompletionContext {
  const state = EditorState.create({ doc });
  const pos = doc.length;
  return {
    state,
    pos,
    aborted: false,
    matchBefore(re: RegExp) {
      const text = state.doc.lineAt(pos).text;
      const m = new RegExp(`(?:${re.source})$`).exec(text);
      return m ? { from: m.index + state.doc.lineAt(pos).from, to: pos, text: m[0] } : null;
    },
  } as unknown as CompletionContext;
}

const items = [{ key: "acme/app#12", kind: "pull-request", state: "open", title: "Fix reset" }];
let calls: string[];

beforeEach(() => {
  calls = [];
  resetGithubCache();
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const body = url.includes("/github/status") ? { configured: configured } : { items };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());
let configured = true;

describe("wikilinkSource", () => {
  it("offers link types after a bar, also for a gh: target", async () => {
    const r = await wikilinkSource(["tracked_by", "related"])(at("see [[gh:acme/app#12|"));
    expect(r?.options.map((o) => o.label)).toEqual(["tracked_by", "related"]);
    expect(r?.from).toBe("see [[gh:acme/app#12|".length);
  });
});

describe("mentionSource", () => {
  const src = mentionSource(() => EN_LABELS, 0);

  it("lists GitHub items for an @ after a space, with a kind filter and a query", async () => {
    configured = true;
    const r = await src(at("see @pr login"));
    expect(r?.from).toBe(4);
    expect(r?.options[0]).toMatchObject({ label: "#12 Fix reset", detail: "PR · open · acme/app" });
    const url = new URL(calls.find((c) => c.includes("/items")) as string, "http://x");
    expect(url.searchParams.get("kind")).toBe("pull-request");
    expect(url.searchParams.get("q")).toBe("login");
  });

  it("asks nothing for an email address or an open wikilink", async () => {
    expect(await src(at("a@b.com"))).toBeNull();
    expect(await src(at("[[note @x"))).toBeNull();
    expect(calls).toEqual([]);
  });

  it("does not ask for items when GitHub is not configured, and asks the status only once", async () => {
    configured = false;
    expect(await src(at("@"))).toBeNull();
    expect(await src(at("@fix"))).toBeNull();
    expect(calls.filter((c) => c.includes("/status"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("/items"))).toEqual([]);
  });

  it("caches the same search, and stops when the request was aborted", async () => {
    configured = true;
    await src(at("@fix"));
    await src(at("@fix"));
    expect(calls.filter((c) => c.includes("/items"))).toHaveLength(1);
    const aborted = at("@zzz");
    (aborted as { aborted: boolean }).aborted = true;
    expect(await src(aborted)).toBeNull();
    expect(calls.filter((c) => c.includes("zzz"))).toEqual([]);
  });
});

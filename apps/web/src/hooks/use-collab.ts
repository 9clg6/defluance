"use client";

import { useEffect, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

export type Awareness = WebsocketProvider["awareness"];

export interface Peer {
  id: number;
  name: string;
  color: string;
}

export interface Collab {
  text: Y.Text;
  meta: Y.Map<string>;
  awareness: Awareness;
  status: "connecting" | "connected" | "disconnected";
  /** The document arrived from the server: the editor can bind to it. */
  synced: boolean;
  /** Nothing arrived in time (a proxy that blocks WebSockets, say): edit the usual way instead. */
  gaveUp: boolean;
  peers: Peer[];
  /** The live text, for the preview. */
  content: string;
  /** The text as it is committed: what the editor started from, or the last Save. */
  base: string | null;
  baseCommit: string | null;
  /** The note was saved from outside the editor since this text began: saving will report a conflict. */
  stale: string | null;
  /** The text differs from the commit it is based on. */
  dirty: boolean;
  /** Replace the text for everyone. */
  replace(text: string): void;
  /** Replace the text and declare it based on this commit (after loading somebody else's version). */
  rebase(text: string, commit: string | null): void;
}

type State = Omit<Collab, "replace" | "rebase">;

/** How long to wait for the first sync before giving up on live editing. */
const GIVE_UP_MS = 4000;

/**
 * Live editing of a note: a Yjs document shared through the server, with who else is here. The server owns identities
 * (names and colours) and permissions; this only connects, and turns the shared state into something React can render.
 * Pass `null` for a note that is not shared live (private notes, or a server that cannot).
 */
export function useCollab(id: string | null, o: { selfName: string | undefined; onSaved: (e: { by: string; commit: string }) => void }): Collab | null {
  const [state, setState] = useState<State | null>(null);
  const callbacks = useRef(o);
  callbacks.current = o;

  useEffect(() => {
    if (!id) {
      setState(null);
      return;
    }
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`${window.location.origin.replace(/^http/, "ws")}/collab`, encodeURIComponent(id), doc, { disableBc: true });
    const text = doc.getText("content");
    const meta = doc.getMap<string>("meta");
    // Awareness ignores a first state whose clock is 0: nobody would see us until we change something. The server replaces
    // this with the name and colour it knows us by.
    provider.awareness.setLocalStateField("user", { name: callbacks.current.selfName ?? "", color: "#475569" });
    let frame = 0;
    let synced = false;
    let gaveUp = false;
    let lastBase: string | null = null;

    const snapshot = (): State => {
      const content = text.toString();
      const base = meta.get("base") ?? null;
      const peers: Peer[] = [];
      for (const [clientId, s] of provider.awareness.getStates()) {
        const u = (s as { user?: { name?: string; color?: string } }).user;
        if (clientId !== doc.clientID && u?.name) peers.push({ id: clientId, name: u.name, color: u.color ?? "#475569" });
      }
      return {
        text, meta, awareness: provider.awareness,
        status: provider.wsconnected ? "connected" : provider.wsconnecting ? "connecting" : "disconnected",
        synced, gaveUp, peers, content, base,
        baseCommit: meta.get("baseCommit") ?? null,
        stale: meta.get("stale") ? (meta.get("current") ?? "") : null,
        dirty: base !== null && content !== base,
      };
    };
    // Typing fires many events: render at most once per frame.
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setState(snapshot()));
    };

    text.observe(update);
    meta.observe((event, tr) => {
      update();
      if (!synced || tr.local || !event.keysChanged.has("baseCommit")) return;
      const commit = meta.get("baseCommit") ?? null;
      const by = meta.get("savedBy") ?? "";
      if (commit && commit !== lastBase && by !== callbacks.current.selfName) callbacks.current.onSaved({ by, commit });
      lastBase = commit;
    });
    provider.awareness.on("change", update);
    provider.on("status", update);
    provider.on("sync", (ok: boolean) => {
      synced = ok;
      lastBase = meta.get("baseCommit") ?? null;
      update();
    });
    const timer = setTimeout(() => {
      if (!synced) {
        gaveUp = true;
        update();
      }
    }, GIVE_UP_MS);
    update();

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      provider.destroy();
      doc.destroy();
      setState(null);
    };
  }, [id]);

  const live = useRef<{ text: Y.Text; meta: Y.Map<string> } | null>(null);
  live.current = state ? { text: state.text, meta: state.meta } : null;
  if (!state) return null;
  const replace = (next: string) => {
    const l = live.current;
    if (!l) return;
    l.text.doc?.transact(() => {
      l.text.delete(0, l.text.length);
      l.text.insert(0, next);
    });
  };
  return {
    ...state,
    replace,
    rebase(next, commit) {
      const l = live.current;
      if (!l) return;
      l.text.doc?.transact(() => {
        l.text.delete(0, l.text.length);
        l.text.insert(0, next);
        l.meta.set("base", next);
        if (commit) l.meta.set("baseCommit", commit);
        l.meta.delete("stale");
        l.meta.delete("current");
      });
    },
  };
}

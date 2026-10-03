import { createHash } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { lastCommitFor, readAt } from "@defluance/vault-core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { type Actor, actorFromRequest, can } from "./auth.js";
import type { Ctx } from "./context.js";
import { isPrivateRow } from "./private-index.js";

/*
 * Live editing of a note by several people, over WebSockets, with Yjs.
 *
 * One room per note, open only while someone is connected. The room holds the note's text (Y.Text "content") and a
 * small map ("meta") that says which commit the text is based on. Git stays the source of truth: nothing is committed
 * until somebody presses Save, which goes through the normal write path (schema check, audit, conflict detection).
 * Unsaved text is kept in the database so a restart, or everybody closing their tab, does not lose it.
 *
 * Who can do what: a connection needs the `read` permission on the note's space to watch and see who else is here,
 * `write` to change the text. Private (encrypted) notes never get a room: their plaintext must not reach a shared
 * document or the drafts table.
 */

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const HEARTBEAT_MS = 30_000;
const IDLE_UNLOAD_MS = 30_000;
const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_MAX_MS = 10_000;
const MAX_PAYLOAD = 4 * 1024 * 1024;
const MAX_ROOMS = 500;
const MAX_CONNS_PER_ACTOR = 20;

/** Solid, saturated, readable on both themes: the colour of a person's cursor. */
const COLORS = ["#2563eb", "#ea580c", "#0d9488", "#ca8a04", "#dc2626", "#0891b2", "#4d7c0f", "#be185d", "#475569"];
const colorOf = (id: string) => COLORS[createHash("sha256").update(id).digest()[0]! % COLORS.length] as string;

interface Conn {
  ws: WebSocket;
  actor: Actor;
  readOnly: boolean;
  ids: Set<number>;
  alive: boolean;
}

class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly text = this.doc.getText("content");
  readonly meta = this.doc.getMap<string>("meta");
  readonly conns = new Map<WebSocket, Conn>();
  saveTimer: NodeJS.Timeout | null = null;
  saveMax: NodeJS.Timeout | null = null;
  unloadTimer: NodeJS.Timeout | null = null;
  ready: Promise<void> = Promise.resolve();
  /** Fingerprints of the text as it was a moment ago, to tell the editor's own Save from a change made elsewhere. */
  recent: string[] = [];
  recentTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly id: string,
    readonly path: string,
  ) {
    this.awareness.setLocalState(null);
  }
}

export class Collab {
  private readonly rooms = new Map<string, Room>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  private readonly heartbeat: NodeJS.Timeout;
  private closed = false;

  constructor(private readonly ctx: Ctx) {
    this.heartbeat = setInterval(() => {
      for (const room of this.rooms.values()) {
        for (const c of room.conns.values()) {
          if (!c.alive) c.ws.terminate();
          else {
            c.alive = false;
            c.ws.ping();
          }
        }
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Answer WebSocket upgrades on `/collab/<note id>` of this HTTP server. */
  attach(server: Server): void {
    server.on("upgrade", (req, socket, head) => {
      if (!new URL(req.url ?? "/", "http://x").pathname.startsWith("/collab/")) return; // not ours: another listener may take it
      void this.upgrade(req, socket, head);
    });
  }

  get roomCount() {
    return this.rooms.size;
  }

  private deny(socket: Duplex, status: number, reason: string) {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    try {
      if (this.closed) return this.deny(socket, 503, "Service Unavailable");
      const url = new URL(req.url ?? "/", "http://x");
      const id = decodeURIComponent(url.pathname.slice("/collab/".length));
      const cookie = /(?:^|;\s*)dfl_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      const auth = await actorFromRequest(this.ctx, { authorization: req.headers.authorization, session: cookie ? decodeURIComponent(cookie) : undefined });
      if (!auth) return this.deny(socket, 401, "Unauthorized");
      // A browser sends Origin: a page on another site must not be able to use the visitor's cookie here.
      if (auth.via === "cookie") {
        const origin = req.headers.origin;
        if (!origin || !(origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}` || this.ctx.allowedOrigins.includes(origin))) return this.deny(socket, 403, "Forbidden");
      }
      if (this.ctx.rateLimiter.take(auth.actor.id)) return this.deny(socket, 429, "Too Many Requests");
      const open = [...this.rooms.values()].reduce((n, r) => n + [...r.conns.values()].filter((c) => c.actor.id === auth.actor.id).length, 0);
      if (open >= MAX_CONNS_PER_ACTOR) return this.deny(socket, 429, "Too Many Requests");

      const note = await this.ctx.store.getNote(id);
      // 404, not 403: do not reveal notes the actor cannot see.
      if (!note || !can(auth.actor, "read", note.space)) return this.deny(socket, 404, "Not Found");
      if (isPrivateRow(note)) return this.deny(socket, 423, "Locked");
      const readOnly = !can(auth.actor, "write", note.space);

      if (!this.rooms.has(id) && this.rooms.size >= MAX_ROOMS) return this.deny(socket, 503, "Service Unavailable");
      const room = this.room(id, note.path);
      await room.ready;
      this.wss.handleUpgrade(req, socket, head, (ws) => this.join(room, ws, auth.actor, readOnly));
    } catch (e) {
      this.ctx.log({ msg: "collab upgrade failed", error: e instanceof Error ? e.message : String(e) });
      this.deny(socket, 500, "Internal Server Error");
    }
  }

  private room(id: string, path: string): Room {
    const known = this.rooms.get(id);
    if (known) {
      if (known.unloadTimer) clearTimeout(known.unloadTimer);
      known.unloadTimer = null;
      return known;
    }
    const room = new Room(id, path);
    this.rooms.set(id, room);
    room.ready = this.load(room).catch((e) => {
      this.rooms.delete(id);
      throw e;
    });

    // changes by people: tell the others, and keep an unsaved draft
    room.doc.on("update", (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const msg = encoding.toUint8Array(enc);
      for (const c of room.conns.values()) if (c.ws !== origin) this.send(c.ws, msg);
      if (origin !== "server") {
        this.scheduleDraft(room);
        this.remember(room);
      }
    });
    room.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = added.concat(updated, removed);
      const conn = typeof origin === "object" && origin ? room.conns.get(origin as WebSocket) : undefined;
      if (conn) {
        for (const c of added) conn.ids.add(c);
        for (const c of removed) conn.ids.delete(c);
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed));
      const msg = encoding.toUint8Array(enc);
      for (const c of room.conns.values()) this.send(c.ws, msg);
    });
    return room;
  }

  /** Remember what the text looks like, at most every 50 ms: a Save arrives a little after the text it carries. */
  private remember(room: Room) {
    if (room.recentTimer) return;
    room.recentTimer = setTimeout(() => {
      room.recentTimer = null;
      room.recent.push(fingerprint(room.text.toString()));
      if (room.recent.length > 100) room.recent.shift();
    }, 50);
    room.recentTimer.unref();
  }

  /** Fill the room from an unsaved draft, or from the note as committed. */
  private async load(room: Room): Promise<void> {
    const note = await this.ctx.store.getNote(room.id);
    if (!note) throw new Error("note disappeared");
    const current = (await lastCommitFor(this.ctx.root, note.path)) ?? "";
    const raw = await readFile(join(this.ctx.root, note.path), "utf8");
    const draft = await this.ctx.sys.loadDraft(room.id);
    room.doc.transact(() => {
      if (draft) Y.applyUpdate(room.doc, draft.state);
      else room.text.insert(0, raw);
    }, "server");
    const base = draft && draft.base_commit !== current ? await readAt(this.ctx.root, note.path, draft.base_commit).catch(() => raw) : raw;
    room.doc.transact(() => {
      room.meta.set("baseCommit", draft?.base_commit ?? current);
      room.meta.set("base", base);
      // The note was saved elsewhere since this draft started: saving it will report a conflict, as it must.
      if (draft && draft.base_commit !== current) {
        room.meta.set("stale", "1");
        room.meta.set("current", current);
      }
    }, "server");
  }

  private join(room: Room, ws: WebSocket, actor: Actor, readOnly: boolean) {
    const conn: Conn = { ws, actor, readOnly, ids: new Set(), alive: true };
    room.conns.set(ws, conn);
    ws.binaryType = "arraybuffer";
    ws.on("pong", () => (conn.alive = true));
    ws.on("message", (data: RawData) => {
      try {
        this.message(room, conn, toBytes(data));
      } catch (e) {
        this.ctx.log({ msg: "collab message failed", note: room.id, error: e instanceof Error ? e.message : String(e) });
        ws.close(1003, "bad message");
      }
    });
    ws.on("close", () => this.leave(room, conn));
    ws.on("error", () => ws.terminate());

    // hand the newcomer the document and everyone's presence
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, room.doc);
    this.send(ws, encoding.toUint8Array(enc));
    const states = room.awareness.getStates();
    if (states.size) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
      this.send(ws, encoding.toUint8Array(a));
    }
  }

  private message(room: Room, conn: Conn, bytes: Uint8Array) {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    if (type === MSG_SYNC) {
      // A reader may ask for the document (step 1) but anything that would change it is dropped.
      const peek = decoding.createDecoder(bytes);
      decoding.readVarUint(peek);
      const sub = decoding.readVarUint(peek);
      if (conn.readOnly && sub !== syncProtocol.messageYjsSyncStep1) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, enc, room.doc, conn.ws);
      if (encoding.length(enc) > 1) this.send(conn.ws, encoding.toUint8Array(enc));
    } else if (type === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(room.awareness, identify(update, conn.actor), conn.ws);
    }
  }

  private leave(room: Room, conn: Conn) {
    room.conns.delete(conn.ws);
    awarenessProtocol.removeAwarenessStates(room.awareness, [...conn.ids], null);
    if (room.conns.size === 0) {
      room.unloadTimer = setTimeout(() => void this.unload(room), IDLE_UNLOAD_MS);
      room.unloadTimer.unref();
    }
  }

  private async unload(room: Room) {
    if (room.conns.size || this.rooms.get(room.id) !== room) return;
    await this.flush(room);
    room.awareness.destroy();
    room.doc.destroy();
    this.rooms.delete(room.id);
  }

  private send(ws: WebSocket, msg: Uint8Array) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg, (e) => e && ws.terminate());
  }

  // ---------------------------------------------------------------- drafts

  private scheduleDraft(room: Room) {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => void this.flush(room), SAVE_DEBOUNCE_MS);
    room.saveTimer.unref();
    room.saveMax ??= setTimeout(() => void this.flush(room), SAVE_MAX_MS);
    room.saveMax.unref();
  }

  /** Keep the text as a draft if it differs from what is committed, drop the draft if it does not. */
  private async flush(room: Room) {
    for (const t of [room.saveTimer, room.saveMax]) if (t) clearTimeout(t);
    room.saveTimer = room.saveMax = null;
    try {
      if (room.text.toString() === room.meta.get("base")) await this.ctx.sys.deleteDraft(room.id);
      else await this.ctx.sys.saveDraft(room.id, room.meta.get("baseCommit") ?? "", Y.encodeStateAsUpdate(room.doc));
    } catch (e) {
      this.ctx.log({ msg: "collab draft not saved", note: room.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * A note was committed through the services. If the text is what the room had a moment ago, somebody pressed Save in
   * the editor: the base moves forward, for everyone. If not, somebody changed the note behind the room's back: it is
   * marked stale and the base stays, so that saving reports a conflict instead of overwriting their change.
   */
  noteWritten(id: string, commit: string, by: string, content: string): void {
    const room = this.rooms.get(id);
    if (!room) return;
    const fp = fingerprint(content);
    const fromEditor = fp === fingerprint(room.text.toString()) || room.recent.includes(fp);
    room.doc.transact(() => {
      if (fromEditor) {
        room.meta.set("baseCommit", commit);
        room.meta.set("base", content);
        room.meta.delete("stale");
        room.meta.delete("current");
      } else {
        room.meta.set("stale", "1");
        room.meta.set("current", commit);
      }
      room.meta.set("savedBy", by);
      room.meta.set("savedAt", this.ctx.now().toISOString());
    }, "server");
    if (fromEditor) this.scheduleDraft(room);
  }

  /** The note is gone or moved: send everyone away, and forget its unsaved draft. */
  async evict(id: string, reason: string): Promise<void> {
    const room = this.rooms.get(id);
    if (room) {
      for (const t of [room.saveTimer, room.saveMax, room.unloadTimer]) if (t) clearTimeout(t);
      for (const c of room.conns.values()) c.ws.close(4404, reason);
      room.awareness.destroy();
      room.doc.destroy();
      this.rooms.delete(id);
    }
    await this.ctx.sys.deleteDraft(id);
  }

  /** Write every unsaved draft now (the timers do it a couple of seconds after typing stops). */
  async flushAll(): Promise<void> {
    for (const room of this.rooms.values()) await this.flush(room);
  }

  /** Unload rooms nobody is in, without waiting for the idle timer. */
  async evictIdle(): Promise<void> {
    for (const room of [...this.rooms.values()]) {
      if (room.unloadTimer) clearTimeout(room.unloadTimer);
      await this.unload(room);
    }
  }

  /** Close every connection and keep the drafts. */
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const room of this.rooms.values()) {
      if (room.unloadTimer) clearTimeout(room.unloadTimer);
      await this.flush(room);
      for (const c of room.conns.values()) c.ws.close(1001, "server stopping");
      room.awareness.destroy();
      room.doc.destroy();
    }
    this.rooms.clear();
    this.wss.close();
  }
}

const fingerprint = (s: string) => createHash("sha256").update(s).digest("base64");

const toBytes = (d: RawData): Uint8Array => (Array.isArray(d) ? Buffer.concat(d) : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d));

/**
 * The name and colour next to a cursor come from the server, not from the client: nobody can sign as somebody else.
 * Re-encodes an awareness update with `user` replaced.
 */
function identify(update: Uint8Array, actor: Actor): Uint8Array {
  const dec = decoding.createDecoder(update);
  const n = decoding.readVarUint(dec);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, n);
  for (let i = 0; i < n; i++) {
    const clientId = decoding.readVarUint(dec);
    const clock = decoding.readVarUint(dec);
    let state = decoding.readVarString(dec);
    try {
      const o = JSON.parse(state) as Record<string, unknown> | null;
      if (o && typeof o === "object") state = JSON.stringify({ ...o, user: { name: actor.name, color: colorOf(actor.id), id: actor.id } });
    } catch {
      state = "null";
    }
    encoding.writeVarUint(enc, clientId);
    encoding.writeVarUint(enc, clock);
    encoding.writeVarString(enc, state);
  }
  return encoding.toUint8Array(enc);
}

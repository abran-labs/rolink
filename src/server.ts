import { timingSafeEqual } from "node:crypto";

import {
  KEY_HEADER,
  LIMITS,
  isName,
  parseSyncRequest,
  type GameContext,
  type Json,
  type StateEntry,
  type SyncResponse,
  type WireCommand,
} from "./protocol.js";
import { memoryStore, type StateStore } from "./store.js";

export interface RolinkOptions {
  /** Shared secret. The game sends it as the `x-rolink-key` header. */
  readonly key: string;
  /** Only these universes may sync. Omit to accept any game holding the key. */
  readonly universes?: readonly number[];
  /** State keys browsers may read through `GET /v1/state/:key`. Nothing is public by default. */
  readonly publicState?: readonly string[];
  /** Where state survives restarts. Defaults to memory. */
  readonly store?: StateStore;
  /** Reject Studio syncs. Defaults to false, so Studio testing works. */
  readonly rejectStudio?: boolean;
  /** Path prefix the handler is mounted under, e.g. "/api/rolink". Defaults to "". */
  readonly basePath?: string;
}

export interface SendOptions {
  /** `one` (default): the first server to poll runs it. `all`: every server that polls before it expires. */
  readonly target?: "one" | "all";
  /** Only servers of this universe receive it. */
  readonly universeId?: number;
  /** Seconds until an undelivered command is dropped. Defaults to 600. */
  readonly ttlSeconds?: number;
}

export type EventHandler = (data: Json, meta: { readonly game: GameContext; readonly at: number; readonly id: string }) => void | Promise<void>;
export type StateHandler = (value: Json, previous: Json | undefined, game: GameContext) => void | Promise<void>;

interface QueuedCommand {
  readonly command: WireCommand;
  readonly target: "one" | "all";
  readonly universeId: number | undefined;
  readonly expiresAt: number;
  /** `one`: delivery lease. `all`: servers already given it. */
  leasedUntil: number;
  readonly deliveredTo: Set<string>;
}

const LEASE_MS = 60_000;
const SEEN_EVENT_LIMIT = 2_000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers });

function sameKey(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface Rolink {
  /** Fetch-style handler: `POST {basePath}/v1/sync` for games, `GET {basePath}/v1/state/:key` for browsers. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** Runs for every event of this type the game sends. */
  on(type: string, handler: EventHandler): () => void;
  /** Runs when the game changes this state key. */
  onState(key: string, handler: StateHandler): () => void;
  /** Latest value of a state key, or undefined. */
  getState<T = Json>(key: string): Promise<StateEntry<T> | undefined>;
  /** Queues a command for game servers; they pick it up on their next sync. Returns its id. */
  send(type: string, data?: Json, options?: SendOptions): string;
}

export function createRolink(options: RolinkOptions): Rolink {
  if (options.key.length < 16) throw new Error("rolink: key must be at least 16 characters");
  const store = options.store ?? memoryStore();
  const basePath = (options.basePath ?? "").replace(/\/+$/, "");
  const publicState = new Set(options.publicState ?? []);
  const universes = options.universes === undefined ? null : new Set(options.universes);
  const eventHandlers = new Map<string, Set<EventHandler>>();
  const stateHandlers = new Map<string, Set<StateHandler>>();
  const seenEvents = new Set<string>();
  let commands: QueuedCommand[] = [];
  let state: Promise<Record<string, StateEntry>> = store.load();

  const subscribe = <H>(map: Map<string, Set<H>>, name: string, handler: H): (() => void) => {
    if (!isName(name)) throw new Error(`rolink: "${name}" must be lowercase snake_case`);
    const set = map.get(name) ?? new Set<H>();
    set.add(handler);
    map.set(name, set);
    return () => set.delete(handler);
  };

  const run = (label: string, task: () => void | Promise<void>): void => {
    Promise.resolve()
      .then(task)
      .catch((error: unknown) => console.error(`[rolink] ${label} handler failed:`, error));
  };

  const markSeen = (id: string): boolean => {
    if (seenEvents.has(id)) return false;
    seenEvents.add(id);
    if (seenEvents.size > SEEN_EVENT_LIMIT) {
      const oldest = seenEvents.values().next().value;
      if (oldest !== undefined) seenEvents.delete(oldest);
    }
    return true;
  };

  const takeCommands = (game: GameContext, acks: readonly string[], now: number): WireCommand[] => {
    const acked = new Set(acks);
    commands = commands.filter(
      (entry) => entry.expiresAt > now && !(entry.target === "one" && acked.has(entry.command.id)),
    );
    const out: WireCommand[] = [];
    for (const entry of commands) {
      if (out.length >= LIMITS.commandsPerSync) break;
      if (entry.universeId !== undefined && entry.universeId !== game.universeId) continue;
      if (entry.target === "one") {
        if (entry.leasedUntil > now) continue;
        entry.leasedUntil = now + LEASE_MS;
      } else {
        if (entry.deliveredTo.has(game.jobId)) continue;
        entry.deliveredTo.add(game.jobId);
      }
      out.push(entry.command);
    }
    return out;
  };

  async function sync(request: Request): Promise<Response> {
    if (!sameKey(request.headers.get(KEY_HEADER), options.key)) return json({ error: "invalid key" }, 401);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > LIMITS.bodyBytes) return json({ error: "body too large" }, 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "body is not JSON" }, 400);
    }
    const parsed = parseSyncRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const { game, events, acks } = parsed.request;
    if (universes !== null && !universes.has(game.universeId)) return json({ error: "universe not allowed" }, 403);
    if (options.rejectStudio === true && game.studio) return json({ error: "studio not allowed" }, 403);

    for (const event of events) {
      if (!markSeen(event.id)) continue;
      for (const handler of eventHandlers.get(event.type) ?? []) {
        run(event.type, () => handler(event.data, { game, at: event.at, id: event.id }));
      }
    }

    const changed = Object.entries(parsed.request.state);
    if (changed.length > 0) {
      const now = Date.now();
      const current = await state;
      const next = { ...current };
      for (const [key, value] of changed) {
        const previous = current[key]?.value;
        next[key] = { key, value, updatedAt: now };
        for (const handler of stateHandlers.get(key) ?? []) run(key, () => handler(value, previous, game));
      }
      state = Promise.resolve(next);
      await store.save(next).catch((error: unknown) => console.error("[rolink] state save failed:", error));
    }

    const response: SyncResponse = { commands: takeCommands(game, acks, Date.now()) };
    return json(response);
  }

  async function readState(key: string): Promise<Response> {
    if (!publicState.has(key)) return json({ error: "not found" }, 404);
    const entry = (await state)[key];
    if (entry === undefined) return json({ error: "no value yet" }, 404, { "cache-control": "no-store" });
    return json(entry, 200, { "cache-control": "public, max-age=15" });
  }

  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (!path.startsWith(basePath)) return json({ error: "not found" }, 404);
      const route = path.slice(basePath.length);
      if (route === "/v1/sync") {
        return request.method === "POST" ? sync(request) : json({ error: "method not allowed" }, 405);
      }
      const stateMatch = /^\/v1\/state\/([a-z][a-z0-9_]{1,40})$/.exec(route);
      if (stateMatch?.[1] !== undefined) {
        return request.method === "GET" ? readState(stateMatch[1]) : json({ error: "method not allowed" }, 405);
      }
      return json({ error: "not found" }, 404);
    },
    on: (type, handler) => subscribe(eventHandlers, type, handler),
    onState: (key, handler) => subscribe(stateHandlers, key, handler),
    async getState<T = Json>(key: string) {
      return (await state)[key] as StateEntry<T> | undefined;
    },
    send(type, data = null, sendOptions = {}) {
      if (!isName(type)) throw new Error(`rolink: "${type}" must be lowercase snake_case`);
      const id = crypto.randomUUID();
      const ttl = (sendOptions.ttlSeconds ?? 600) * 1000;
      commands.push({
        command: { id, type, data },
        target: sendOptions.target ?? "one",
        universeId: sendOptions.universeId,
        expiresAt: Date.now() + ttl,
        leasedUntil: 0,
        deliveredTo: new Set(),
      });
      return id;
    },
  };
}

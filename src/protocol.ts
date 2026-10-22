/**
 * Rolink wire protocol, version 1.
 *
 * Roblox servers cannot accept inbound requests, so every exchange is one
 * game-initiated `POST {base}/v1/sync`: the game pushes events and state and
 * pulls commands in the same round trip.
 */

export const PROTOCOL_VERSION = 1;
export const KEY_HEADER = "x-rolink-key";

export const LIMITS = {
  bodyBytes: 512 * 1024,
  eventsPerSync: 50,
  stateKeysPerSync: 50,
  commandsPerSync: 25,
  acksPerSync: 100,
} as const;

const NAME = /^[a-z][a-z0-9_]{1,40}$/;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface GameContext {
  readonly universeId: number;
  readonly placeId: number;
  readonly jobId: string;
  readonly studio: boolean;
  readonly privateServer: boolean;
}

export interface WireEvent {
  /** Unique per sender; retries reuse it so the site drops duplicates. */
  readonly id: string;
  readonly type: string;
  readonly data: Json;
  /** Unix seconds when the game queued it. */
  readonly at: number;
}

export interface WireCommand {
  readonly id: string;
  readonly type: string;
  readonly data: Json;
}

export interface SyncRequest {
  readonly v: typeof PROTOCOL_VERSION;
  readonly game: GameContext;
  readonly events: readonly WireEvent[];
  readonly state: Readonly<Record<string, Json>>;
  readonly acks: readonly string[];
}

export interface SyncResponse {
  readonly commands: readonly WireCommand[];
}

export interface StateEntry<T = Json> {
  readonly key: string;
  readonly value: T;
  /** Unix milliseconds the site received it. */
  readonly updatedAt: number;
}

export const isName = (value: unknown): value is string => typeof value === "string" && NAME.test(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;

const isPositiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function parseGame(value: unknown): GameContext | null {
  if (!isObject(value)) return null;
  const { universeId, placeId, jobId, studio, privateServer } = value;
  if (!isPositiveInt(universeId) || !isPositiveInt(placeId) || typeof jobId !== "string" || jobId.length > 64) {
    return null;
  }
  return { universeId, placeId, jobId, studio: studio === true, privateServer: privateServer === true };
}

function parseEvent(value: unknown): WireEvent | null {
  if (!isObject(value) || !isId(value.id) || !isName(value.type)) return null;
  const at = typeof value.at === "number" && Number.isFinite(value.at) ? value.at : 0;
  return { id: value.id, type: value.type, data: (value.data ?? null) as Json, at };
}

export type ParseResult = { readonly ok: true; readonly request: SyncRequest } | { readonly ok: false; readonly error: string };

/** Validates a decoded sync body. Unknown fields are ignored for forward compatibility. */
export function parseSyncRequest(body: unknown): ParseResult {
  if (!isObject(body)) return { ok: false, error: "body must be an object" };
  if (body.v !== PROTOCOL_VERSION) return { ok: false, error: `unsupported protocol version ${String(body.v)}` };
  const game = parseGame(body.game);
  if (game === null) return { ok: false, error: "game context is invalid" };

  const rawEvents = body.events ?? [];
  if (!Array.isArray(rawEvents) || rawEvents.length > LIMITS.eventsPerSync) return { ok: false, error: "events is invalid" };
  const events: WireEvent[] = [];
  for (const raw of rawEvents) {
    const event = parseEvent(raw);
    if (event === null) return { ok: false, error: "an event is invalid" };
    events.push(event);
  }

  const rawState = body.state ?? {};
  if (!isObject(rawState)) return { ok: false, error: "state must be an object" };
  const keys = Object.keys(rawState);
  if (keys.length > LIMITS.stateKeysPerSync || !keys.every(isName)) return { ok: false, error: "state keys are invalid" };

  const rawAcks = body.acks ?? [];
  if (!Array.isArray(rawAcks) || rawAcks.length > LIMITS.acksPerSync || !rawAcks.every(isId)) {
    return { ok: false, error: "acks is invalid" };
  }

  return { ok: true, request: { v: PROTOCOL_VERSION, game, events, state: rawState as Record<string, Json>, acks: rawAcks } };
}

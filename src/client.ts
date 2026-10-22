import type { Json, StateEntry } from "./protocol.js";

export interface ClientOptions {
  /** Where the site mounted Rolink, e.g. "/api/rolink". Defaults to "". */
  readonly baseUrl?: string;
}

/** Browser-safe reader for public state. Returns null when missing or unreachable. */
export async function fetchState<T = Json>(key: string, options: ClientOptions = {}): Promise<StateEntry<T> | null> {
  const base = (options.baseUrl ?? "").replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/v1/state/${encodeURIComponent(key)}`);
    if (!response.ok) return null;
    return (await response.json()) as StateEntry<T>;
  } catch {
    return null;
  }
}

/** Calls back with the value now and every `intervalMs` (default 30s). Returns a stop function. */
export function watchState<T = Json>(
  key: string,
  callback: (entry: StateEntry<T> | null) => void,
  options: ClientOptions & { readonly intervalMs?: number } = {},
): () => void {
  let stopped = false;
  const tick = async () => {
    const entry = await fetchState<T>(key, options);
    if (!stopped) callback(entry);
  };
  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? 30_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export type { Json, StateEntry } from "./protocol.js";

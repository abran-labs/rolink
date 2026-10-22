import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Json, StateEntry } from "./protocol.js";

/** Where the site keeps the latest state per key. Commands and dedupe stay in memory. */
export interface StateStore {
  load(): Promise<Record<string, StateEntry>>;
  save(entries: Record<string, StateEntry>): Promise<void>;
}

/** Keeps state for the life of the process. */
export function memoryStore(): StateStore {
  let entries: Record<string, StateEntry> = {};
  return {
    load: async () => ({ ...entries }),
    save: async (next) => {
      entries = { ...next };
    },
  };
}

/** Keeps state in one JSON file, written atomically, so it survives restarts. */
export function fileStore(path: string): StateStore {
  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
        return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, StateEntry<Json>>) : {};
      } catch {
        return {};
      }
    },
    async save(entries) {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.tmp`;
      await writeFile(temp, JSON.stringify(entries));
      await rename(temp, path);
    },
  };
}

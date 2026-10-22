import { describe, expect, test } from "bun:test";

import { createRolink, KEY_HEADER } from "./index.js";

const KEY = "test-key-0123456789";
const game = { universeId: 10, placeId: 20, jobId: "job-a", studio: false, privateServer: false };

function sync(link: ReturnType<typeof createRolink>, body: Record<string, unknown>, key = KEY) {
  return link.fetch(
    new Request("http://site/api/rolink/v1/sync", {
      method: "POST",
      headers: { [KEY_HEADER]: key, "content-type": "application/json" },
      body: JSON.stringify({ v: 1, game, events: [], state: {}, acks: [], ...body }),
    }),
  );
}

const make = (extra: Partial<Parameters<typeof createRolink>[0]> = {}) =>
  createRolink({ key: KEY, basePath: "/api/rolink", publicState: ["global_stats"], ...extra });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("rolink server", () => {
  test("rejects a wrong key and a disallowed universe", async () => {
    expect((await sync(make(), {}, "wrong-key-0123456789")).status).toBe(401);
    expect((await sync(make({ universes: [99] }), {})).status).toBe(403);
  });

  test("stores state and serves only public keys", async () => {
    const link = make();
    const seen: unknown[] = [];
    link.onState("global_stats", (value) => void seen.push(value));
    expect((await sync(link, { state: { global_stats: { EggsHatched: 5 }, secret_thing: 1 } })).status).toBe(200);
    await settle();
    expect(seen).toEqual([{ EggsHatched: 5 }]);

    const pub = await link.fetch(new Request("http://site/api/rolink/v1/state/global_stats"));
    expect(((await pub.json()) as { value: unknown }).value).toEqual({ EggsHatched: 5 });
    expect((await link.fetch(new Request("http://site/api/rolink/v1/state/secret_thing"))).status).toBe(404);
  });

  test("delivers each event once even when the game retries", async () => {
    const link = make();
    let count = 0;
    link.on("pet_hatch", () => void count++);
    const event = { id: "e1", type: "pet_hatch", data: { pet: "Apophis" }, at: 1 };
    await sync(link, { events: [event] });
    await sync(link, { events: [event] });
    await settle();
    expect(count).toBe(1);
  });

  test("hands a one-target command to a single server until acked", async () => {
    const link = make();
    const id = link.send("announce", { text: "hi" });
    const first = (await (await sync(link, {})).json()) as { commands: { id: string }[] };
    expect(first.commands.map((c) => c.id)).toEqual([id]);
    const other = (await (await sync(link, {})).json()) as { commands: unknown[] };
    expect(other.commands).toEqual([]);
    await sync(link, { acks: [id] });
  });

  test("hands an all-target command to every server once", async () => {
    const link = make();
    link.send("refresh", null, { target: "all" });
    const a = (await (await sync(link, {})).json()) as { commands: unknown[] };
    const again = (await (await sync(link, {})).json()) as { commands: unknown[] };
    expect(a.commands.length).toBe(1);
    expect(again.commands.length).toBe(0);
  });

  test("rejects a malformed body", async () => {
    expect((await sync(make(), { v: 2 })).status).toBe(400);
    expect((await sync(make(), { events: [{ id: "x", type: "Bad Type" }] })).status).toBe(400);
  });
});

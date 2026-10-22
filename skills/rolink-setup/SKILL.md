---
name: rolink-setup
description: Connect a Roblox game to a website with Rolink (@abran-labs/rolink on npm, abran-labs/rolink on Wally). Use when the user says link my game to my site, show game stats on my website, send game events to a website, send commands from a site to Roblox servers, set up rolink, or add a rolink event/state/command. Skip Discord-only alerts (Orbi) and Open Cloud DataStore admin scripts.
---

# Rolink setup

Rolink is one HTTPS endpoint on the website. Roblox servers call it every 30 s:
they push **events** and changed **state**, and pull **commands**. The site never
calls the game.

| Kind | Game API | Site API | Example |
| --- | --- | --- | --- |
| Event | `link.send(type, data)` | `rolink.on(type, fn)` | rare hatch, purchase |
| State | `link.setState(key, value)` | `rolink.getState(key)`, browser `watchState(key)` | global stats |
| Command | `link.onCommand(type, fn)` | `rolink.send(type, data, { target })` | announce, refresh config |

Names are lowercase snake_case, 2–41 chars. State is sent only when it changes.

## 1. Website

1. `bun add @abran-labs/rolink` (or `npm install`).
2. Generate the shared key, at least 32 random chars, and keep it in the site's env as `ROLINK_KEY`:
   `bun -e 'console.log(crypto.randomUUID() + crypto.randomUUID())'`.
   Never commit it, never print it in logs or chat.
3. Mount the handler on a server route. It answers `POST {basePath}/v1/sync` and `GET {basePath}/v1/state/:key`:

```ts
import { createRolink, fileStore } from "@abran-labs/rolink";

export const rolink = createRolink({
  key: process.env.ROLINK_KEY!,
  universes: [UNIVERSE_ID],            // lock to the user's game
  publicState: ["global_stats"],       // only these are browser-readable
  store: fileStore("data/rolink.json"),// survives restarts; gitignore it
  basePath: "/api/rolink",
});
// Bun.serve({ fetch: rolink.fetch }) / Hono: app.all("/api/rolink/*", c => rolink.fetch(c.req.raw))
// Next route handler: export const POST = GET = (req: Request) => rolink.fetch(req)
```

Static sites (Astro static, Vite SPA) need a small server for this route. Reuse
one if the project has it; otherwise add one and proxy `/api/rolink` to it.

4. Browser: `import { watchState } from "@abran-labs/rolink/client"`.

## 2. Game

1. `wally.toml`: `[server-dependencies]` `Rolink = "abran-labs/rolink@0.1.0"`, then `wally install`.
2. Enable **Allow HTTP Requests** (Studio → File → Experience Settings → Security).
3. Store the key as experience secret `rolink_key`, domain = the site host. See "Secrets" below.
4. Connect once from a server Script/Service:

```lua
local link = Rolink.connect({
	url = "https://SITE/api/rolink",
	key = HttpService:GetSecret("rolink_key"),
})
```

Wrap `GetSecret` in `pcall`; when missing, skip `connect` so Studio without a local secret still runs.
Send state from the server that owns it, not from every server. Every server sending the same
global value is fine (latest wins), only wasteful.

## Secrets

**Live / team test servers:** set it through Open Cloud when the user has an API key with
the `secret-store` system (scope `universe.secret:write`) for that universe:

```bash
ROBLOX_API_KEY=... ROLINK_KEY=... bun skills/rolink-setup/scripts/set-roblox-secret.ts \
  --universe UNIVERSE_ID --name rolink_key --domain SITE_HOST
```

The script needs `libsodium-wrappers`; run `bun add -d libsodium-wrappers` in the project first if it is missing.
Get both values from the environment or the user's secret manager, never as literal
args. If no such API key exists, tell the user: Creator Dashboard → the game →
Secrets → Create Secret (name `rolink_key`, the key, domain = site host).

**Studio playtests** never see dashboard secrets. That is manual: Studio → File →
Experience Settings → Security → Local Secrets → add `rolink_key`. Tell the user;
an agent cannot do it.

## Verify

- `curl -s https://SITE/api/rolink/v1/state/KEY` → 404 `no value yet` before the game syncs, JSON after.
- Wrong key → game output `[Rolink] key rejected by the site; Rolink stopped for this server`.
- Site logs `[rolink] ... handler failed` when a handler throws; the sync itself still succeeds.

## Limits

50 events, 50 state keys, 25 commands per sync; 512 KB body. Game queue holds 200 events.
Commands: `target: "one"` (default) reaches one server, `"all"` every server that syncs before
`ttlSeconds` (600). Commands and event dedupe live in site memory; a site restart drops pending commands.

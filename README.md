![Rolink banner showing a game node linked to a site node](https://raw.githubusercontent.com/abran-labs/rolink/master/.github/assets/rolink-banner.svg)

# Rolink

[![npm](https://img.shields.io/npm/v/@abran-labs/rolink)](https://www.npmjs.com/package/@abran-labs/rolink)
![downloads](https://img.shields.io/npm/dm/@abran-labs/rolink)
![license](https://img.shields.io/npm/l/@abran-labs/rolink)

**A two-way link between Roblox games and websites.**

## Install

Website:

```sh
bun add @abran-labs/rolink
```

```sh
npm install @abran-labs/rolink
```

Roblox (Wally):

```toml
[server-dependencies]
Rolink = "abran-labs/rolink@=0.1.0"
```

## What it carries

| Kind | Direction | Use it for |
| --- | --- | --- |
| Event | game → site | Things that happened: a rare hatch, a purchase |
| State | game → site | Latest value per key: global stats, server count |
| Command | site → game | Things the game should do: announce, refresh config |

Roblox servers can't receive requests, so the game calls the site every
30 seconds. Each call sends queued events and changed state, and gets back
any waiting commands.

## Website

```ts
import { createRolink, fileStore } from "@abran-labs/rolink";

const rolink = createRolink({
  key: process.env.ROLINK_KEY!,
  universes: [10765012427],
  publicState: ["global_stats"],
  store: fileStore("data/rolink.json"),
  basePath: "/api/rolink",
});

rolink.on("pet_hatch", (data, { game }) => console.log(game.placeId, data));
rolink.send("announce", { text: "Double luck starts now" }, { target: "all" });

Bun.serve({ fetch: rolink.fetch });
```

In the browser:

```ts
import { watchState } from "@abran-labs/rolink/client";

watchState("global_stats", (entry) => render(entry?.value), { baseUrl: "/api/rolink" });
```

## Game

```lua
local Rolink = require(ServerScriptService.ServerPackages.Rolink)

local link = Rolink.connect({
	url = "https://example.com/api/rolink",
	key = HttpService:GetSecret("rolink_key"),
})

link.send("pet_hatch", { pet = "Apophis" })
link.setState("global_stats", { EggsHatched = 1248033 })
link.onCommand("announce", function(data)
	print(data.text)
end)
```

## Behavior

- `setState` sends only when the value changed. The site keeps the latest copy per key.
- Events keep their id across retries, so the site runs each one once.
- Commands are `one` (default, first server to sync) or `all` (every server, once each).
  The game acks each command and never runs the same id twice.
- Failures back off up to 5 minutes. A `401` stops the link for that server.
- Browsers can read only keys listed in `publicState`. Everything else needs the key.

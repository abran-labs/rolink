![Rolink banner showing a Roblox node linked to a web node](https://raw.githubusercontent.com/abran-labs/rolink/master/.github/assets/rolink-banner.svg)

# Rolink

[![npm](https://img.shields.io/npm/v/@abran-labs/rolink)](https://www.npmjs.com/package/@abran-labs/rolink)
[![wally](https://img.shields.io/badge/wally-abran--labs%2Frolink-ad4646)](https://wally.run/package/abran-labs/rolink)
![downloads](https://img.shields.io/npm/dm/@abran-labs/rolink)
![license](https://img.shields.io/npm/l/@abran-labs/rolink)

**A two-way link between Roblox and web.**

## Install

Web:

```sh
bun add @abran-labs/rolink
```

```sh
npm install @abran-labs/rolink
```

Roblox:

```toml
[server-dependencies]
Rolink = "abran-labs/rolink@=0.1.0"
```

## What it carries

| Kind | Direction | Use it for |
| --- | --- | --- |
| Event | Roblox → web | Things that happened: a rare hatch, a purchase |
| State | Roblox → web | Latest value per key: global stats, server count |
| Command | web → Roblox | Things the game should do: announce, refresh config |

## How it moves

| | Roblox | Web |
| --- | --- | --- |
| Pushes | ✅ every 30 seconds | ❌ |
| Commands reach Roblox | on its next push | queued until then |

## AI agents

The repo ships an agent skill that sets up both sides, the shared key, and the Roblox secret:

```sh
npx skills add abran-labs/rolink
```

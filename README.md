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

## Message types

| Kind | Direction | Use it for |
| --- | --- | --- |
| Event | Roblox → web | Something that happened in the game |
| State | Roblox → web | The latest value for a key |
| Command | web → Roblox | An action the game should take |

## For AI agents

```sh
npx skills add abran-labs/rolink
```

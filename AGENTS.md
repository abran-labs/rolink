# Rolink agent guide

Two-way link between Roblox and web. One repo, two packages, one protocol.

| Path | Package | Registry |
| --- | --- | --- |
| `src/` | `@abran-labs/rolink` (site server + `./client` for browsers) | npm |
| `roblox/` | `abran-labs/rolink` (server-only Luau) | public Wally (wally.run) |
| `skills/rolink-setup/` | Agent skill for consumers | `npx skills add abran-labs/rolink` |

## Setting Rolink up in a project

Follow `skills/rolink-setup/SKILL.md`.

## Working on Rolink

- Protocol lives in `src/protocol.ts`. A wire change touches `src/protocol.ts`, `src/server.ts`,
  `roblox/src/Core.luau`, both test suites, `README.md`, and the skill, in one commit.
  Breaking wire changes bump `PROTOCOL_VERSION`.
- Keep the npm and Wally versions equal. Release: bump `package.json` + `roblox/wally.toml`,
  then `npm publish` and `cd roblox && wally publish`. Published versions are immutable.
- `roblox/src/Core.luau` stays free of Roblox globals; effects come through `Deps`.

## Verify

```bash
bun run check && bun test && bun run build
cd roblox && lune run tests/run.luau && stylua --check src tests && selene src
```

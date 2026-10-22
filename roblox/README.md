# Rolink (Wally)

Server-only Roblox side of Rolink. Docs and the website package:
https://github.com/abran-labs/rolink

```toml
[server-dependencies]
Rolink = "abran-labs/rolink@=0.1.1"
```

## Development

```bash
lune run tests/run.luau
stylua --check src tests
selene src
wally package --list
```

Published to public Wally (wally.run). Versions are immutable; bump to release.

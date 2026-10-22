# Rolink (Wally)

Server-only Roblox side of Rolink. Docs and the website package:
https://github.com/abran-labs/rolink

```toml
[server-dependencies]
Rolink = "abran-labs/rolink@=0.1.0"
```

## Development

```bash
lune run tests/run.luau
stylua --check src tests
selene src
wally package --list
```

Source manifest stays `private = true`. Versions are immutable.

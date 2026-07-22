# XR 3.1.5 → XR 3.1.6 Migration Notes

XR 3.1.6 is a Baseline Integrity release. It adds diagnostics, release evidence, validation scripts, and documentation corrections. It does not introduce a destructive database migration.

## Before upgrading

1. Stop running XR daemon/processes.
2. Back up `XR_HOME` (default `~/.xr`).
3. Record the current code/package version.

```bash
xr --version
XR_HOME_DIR="${XR_HOME:-$HOME/.xr}"
tar --exclude='.env' -czf "xr-backup-$(date +%Y%m%d-%H%M%S).tgz" -C "$(dirname "$XR_HOME_DIR")" "$(basename "$XR_HOME_DIR")"
```

## Upgrade from a Git checkout

```bash
cd /path/to/xr
git pull --ff-only origin main
bun install --frozen-lockfile
bun run set-version:check
bun run baseline:validate
xr doctor --json
```

## Upgrade from package install

Install/pin `@rrrtx/xr@3.1.6` using your package manager, then run:

```bash
xr --version
xr doctor --json
```

## Data/config compatibility

- Workspace SQLite schema is not destructively changed by 3.1.6.
- Global/workspace configuration remains backward compatible.
- Existing provider selection, budget configuration, memory data, audit logs, skills/plugins/MCP metadata, and daemon token behavior remain compatible.

## Rollback

See `ROLLBACK.md`. In short: stop XR, restore the pre-upgrade `XR_HOME` backup, and reinstall/check out the known-good 3.1.5 code/package.

## Known upgrade failures

- Lockfile install failure: do not continue; resolve dependency/lockfile mismatch first.
- Required doctor failure: remediate `platform`, `bun`, `package-manager`, `config`, or `audit` failure before release use.
- Optional warning: local runtime/provider/browser/voice/control warning only blocks workflows that depend on that optional component.

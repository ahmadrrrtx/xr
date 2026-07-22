# XR 3.1.6 Rollback Guide

## Code rollback

If XR 3.1.6 is installed from Git:

```bash
cd <xr-checkout>
git fetch --tags origin
git checkout <known-good-3.1.5-tag-or-commit>
bun install --frozen-lockfile
bun run set-version:check
```

If installed from a package manager, reinstall the previously verified `@rrrtx/xr` 3.1.5 package/version according to that manager's normal pinning command.

## Data backup before upgrade

Before moving from 3.1.5 to 3.1.6, back up the XR home directory. Default path is `~/.xr`; if `XR_HOME` is set, back up that directory instead.

Recommended backup contents:

- workspace databases: `xr.db`, `workspaces/*/*.db`, and WAL/SHM sidecars if present;
- workspace configs: `config.json`, `workspaces/*/config.json`;
- capability metadata under workspace `plugins/`, `skills/`, and `memories/` directories;
- secret references only. Do not export plaintext secrets unless your local policy requires a full encrypted backup.

Example:

```bash
XR_HOME_DIR="${XR_HOME:-$HOME/.xr}"
tar --exclude='.env' -czf "xr-backup-$(date +%Y%m%d-%H%M%S).tgz" -C "$(dirname "$XR_HOME_DIR")" "$(basename "$XR_HOME_DIR")"
```

## Restore data

1. Stop all XR processes and daemon instances.
2. Move the current XR home aside:
   ```bash
   mv "${XR_HOME:-$HOME/.xr}" "${XR_HOME:-$HOME/.xr}.failed-$(date +%Y%m%d-%H%M%S)"
   ```
3. Extract the verified backup to the original path.
4. Start the known-good XR version and run:
   ```bash
   xr doctor --json
   ```

## Migration rollback behavior

XR 3.1.6 does not introduce a destructive workspace/database migration. If a future migration step fails, stop before continuing, preserve the failed state, restore the pre-upgrade backup, and report the exact failing command and logs.

## Diagnostic rollback

The new diagnostics are additive. If `xr doctor --json` itself fails but existing core commands still work, use `xr --version`, `xr help`, and direct backup/restore procedures above to recover. Do not run repair commands that mutate state unless the output explicitly describes the action and you have a current backup.

# XR Plugins (XR 1.0)

XR gains new integrations and skills through **plugins** — not by editing core
code. Plugins are **local-first, explicit, permission-based, and sandboxed by
design**. A plugin can never silently access your secrets, keys, memory,
filesystem, browser, or network, and it can never bypass your spend caps or
safety gates.

> Design rule: the core defines a strict boundary. Plugins *contribute*
> capabilities; they never *own* the runtime.

---

## Quick start

```bash
# See what's installed
xr plugins

# Inspect a plugin BEFORE installing (manifest + permissions + compatibility)
xr plugins inspect ./plugins/hello

# Install a local plugin (shows permissions, asks to approve)
xr plugins install ./plugins/hello

# Enable it (separate, conscious step — install does not auto-enable)
xr plugins enable hello

# Run a command a plugin contributes
xr plugin hello greet rrrtx
# (equivalent to: xr plugins run hello greet rrrtx)

# Health of every installed plugin
xr plugins doctor
```

`xr doctor` also reports a one-line plugin health summary.

---

## Commands

| Command | What it does |
| --- | --- |
| `xr plugins` / `xr plugins list` | List installed plugins with status + permission count |
| `xr plugins install <path>` | Install a local plugin (shows permissions, asks to approve) |
| `xr plugins inspect <id\|path>` | Show manifest, permissions, compatibility — **no code runs** |
| `xr plugins permissions <id>` | Show exactly what a plugin can access (and what's granted) |
| `xr plugins enable <id>` | Enable a plugin (re-checks compatibility + dependencies) |
| `xr plugins disable <id>` | Disable a plugin (refuses if a dependent is still enabled) |
| `xr plugins update <id> [path]` | Update from its source; rejects if it asks for **new** permissions |
| `xr plugins remove <id>` | Uninstall and delete the plugin's files |
| `xr plugins run <id> <cmd> …` | Run a command a plugin contributes |
| `xr plugin <id> <cmd> …` | Shorthand for `xr plugins run …` |
| `xr plugins doctor` | Per-plugin health (loaded / error / untrusted / incompatible) |

Useful flags: `--yes/-y` (non-interactive), `--enable` (enable after install),
`--grant a,b,c` (grant only a subset of requested permissions), `--json`.

---

## The install flow

1. You ask to install a plugin.
2. XR parses + validates its manifest and shows the **permissions** and
   **compatibility** — sensitive permissions are called out loudly.
3. You approve (or grant a subset with `--grant`).
4. XR copies the plugin into `~/.xr/plugins/<id>/` and records the
   **granted permissions** and a **trust hash** of the entrypoint.
5. The plugin is installed **disabled**. You enable it as a separate step.
6. On enable, XR re-checks compatibility + dependencies.
7. When loaded, the plugin's tools become available to the agent
   (namespaced + approval-gated); its commands are runnable via `xr plugin`.
8. `xr plugins disable` / `xr plugins remove` clean it up — `dispose()` is
   called if the plugin defines one.

---

## The manifest (`xr-plugin.json`)

Every plugin ships an `xr-plugin.json` next to its entrypoint:

```json
{
  "id": "github",
  "name": "GitHub",
  "version": "1.0.0",
  "author": "rrrtx",
  "description": "Look up public GitHub repositories.",
  "type": "integration",
  "entrypoint": "index.ts",
  "permissions": ["net", "secrets"],
  "dependencies": [],
  "compatibility": ">=1.0.0 <2.0.0",
  "apiVersion": 1,
  "source": "https://example.com/github-plugin",
  "updateSource": "https://example.com/github-plugin",
  "trust": { "sha256": "…optional, recorded at install…" },
  "homepage": "https://github.com/ahmadrrrtx/xr"
}
```

| Field | Meaning |
| --- | --- |
| `id` | Stable unique id (lowercase, optional `@scope/`). Becomes the install dir name. |
| `name`, `version`, `author`, `description` | Display metadata. `version` is semver. |
| `type` | One of: `tool`, `integration`, `provider`, `memory`, `research`, `automation`, `ui`, `voice`, `workflow`. |
| `entrypoint` | Module to import (default `index.ts`). |
| `permissions` | Closed set of scopes the plugin requests (see below). |
| `dependencies` | Other plugin ids that must be installed + enabled first. |
| `compatibility` | semver range of XR core versions supported (e.g. `>=1.0.0 <2.0.0`). |
| `apiVersion` | Host ABI version the plugin was built against. |
| `source` / `updateSource` | Where it came from / where to update from. |
| `trust.sha256` / `trust.signature` / `trust.keyId` | Optional trust metadata. |

A malformed manifest fails **safely** with a precise reason — it never crashes XR.

---

## Permissions

Permissions are **least-privilege and explicit**. A plugin receives a capability
**only if** (a) it declared the permission, **and** (b) you granted it. An
ungranted capability is genuinely absent from the plugin's host object — there is
no way to "reach around" it.

| Scope | Grants |
| --- | --- |
| `fs:read` / `fs:write` | Read/write files **inside the plugin's own data dir only** (never your cwd). |
| `net` | Outbound network — **still constrained by your egress allow-list**. |
| `shell` | Run shell commands (highest risk; always approval-gated). |
| `browser` | Drive the browser-automation surface. |
| `memory:read` / `memory:write` | Recall / add durable memory (writes are tagged with the plugin id). |
| `provider` | Call the active model — **spend-capped; never bypasses your budget**. |
| `secrets` | Read a **named** secret; the value is returned to the plugin but **never logged**. |
| `voice` | Contribute voice phrases / speak. |
| `control` | Request safe computer-control actions (approval-gated). |
| `ui` | Contribute dashboard / UI panels. |

Sensitive permissions (`shell`, `secrets`, `control`, `net`, `fs:write`) are
highlighted at install time.

**Enterprise / policy hook:** `plugins.deniedPermissions` in `config.json` lists
scopes XR will *never* grant to any plugin, regardless of manifest or approval.

---

## Security guarantees

- **No ambient authority.** A plugin only ever sees a frozen `PluginHost`. It
  never receives the database, raw config, `process.env`, `fetch`, or `node:fs`.
- **Capability = permission.** `host.net`, `host.secrets`, `host.fs`, etc. exist
  **only** for granted permissions.
- **Egress is inherited.** `host.net.fetch` reuses XR's egress allow-list. A
  plugin cannot widen it.
- **Budget is inherited.** `host.provider.chat` runs through the budget manager
  and records spend. A plugin cannot get free, uncapped LLM calls.
- **Secrets stay quiet.** `host.secrets.get(name)` audits the **name** only; the
  value is never written to logs or the audit chain (which also redacts).
- **Tamper-evident.** The entrypoint is hashed at install. If it changes later,
  the plugin is refused as `untrusted` and not loaded. (`plugins.requireTrust`,
  default `true`.)
- **Fail-safe loading.** A plugin that throws on import or `activate()` is
  isolated, recorded with a reason, and skipped — XR core and other plugins keep
  working.
- **Audited lifecycle.** install / enable / disable / remove / load / tool calls
  are all written to the tamper-evident audit log (`xr verify-log`).
- **Approval-gated tools.** Plugin tools are exposed to the agent as
  `plugin.<id>.<name>` and require approval by default (a pure read-only tool may
  opt out with `requiresApproval: false`).

---

## Writing a plugin

A plugin is a directory with `xr-plugin.json` + an entry module that exports an
`activate(host)` function (named export or default). It returns its
contributions.

```ts
// plugins/hello/index.ts
import type { PluginHost, PluginContributions } from "../../src/plugins/types.ts";

export function activate(host: PluginHost): PluginContributions {
  host.log(`activated on XR ${host.coreVersion}`);
  return {
    commands: [
      { name: "greet", run(argv) { host.log(`hello, ${argv[0] ?? "world"}!`); } },
    ],
    tools: [
      {
        name: "echo",
        description: "Echo a message back.",
        requiresApproval: false, // pure + harmless
        run(args) { return { ok: true, output: `echo: ${args.message ?? ""}` }; },
      },
    ],
    dispose() { host.log("disposed"); }, // optional teardown
  };
}

export default activate;
```

A plugin may contribute:

- **commands** — runnable via `xr plugin <id> <cmd>`
- **tools** — offered to the agent (namespaced + approval-gated)
- **prompts** — declarative templates (data only)
- **dispose()** — optional teardown on disable/unload

> Best practice: a plugin should import **only** `PluginHost` types and use the
> host's capabilities. Importing `node:fs`, `fetch`, or core internals directly
> is the review red-flag a future signed-marketplace linter will reject.

See `plugins/hello/` (no permissions) and `plugins/github/` (net + secrets) for
working references.

---

## Configuration (`~/.xr/config.json`)

```json
{
  "plugins": {
    "enabled": true,
    "requireTrust": true,
    "deniedPermissions": []
  }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Load enabled plugins' tools into the agent. `false` hard-disables loading (management commands still work). |
| `requireTrust` | `true` | Refuse a plugin whose entrypoint hash changed since install. |
| `deniedPermissions` | `[]` | Scopes XR will never grant to any plugin. |

---

## Compatibility & versioning

- **Core version:** `1.0.0` (`src/core/version.ts`).
- **Host ABI version:** `1`. Bumped only when the host surface changes in a
  breaking way. A plugin built for a newer ABI than your XR is refused as
  `incompatible`.
- Plugins declare a semver `compatibility` range; XR checks it at install and
  again at enable.

---

## Limitations (honest notes for 1.0)

- **Isolation is in-process.** Plugins run in the same Bun process. The boundary
  is the capability-scoped host + the approval/egress/budget gates, not an OS
  sandbox or separate worker. A `worker_threads`/subprocess isolate is the
  natural next step (the host interface is already the seam for it).
- **Trust = hash baseline.** Cryptographic signature verification fields exist in
  the manifest (`trust.signature`, `trust.keyId`) but signature *enforcement*
  ships later with a key-distribution story. Today's guarantee is tamper-evidence
  vs. the install-time hash.
- **Local-first only.** No remote catalog/marketplace yet — install is from a
  local directory. The registry + `updateSource` are designed so a remote
  catalog and signed packages can be layered on without changing the model.
- **`browser`, `voice`, `control`, `ui` permissions** are reserved in the model;
  their host surfaces are intentionally minimal in 1.0 and will expand.

These are deliberate: a practical, stable foundation first — fancy later.

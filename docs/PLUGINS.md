# XR Plugin Platform

XR Stage 10 turns plugins into a first-class, permission-aware subsystem. Plugins can contribute tools, CLI commands, skills, MCP connectors, UI metadata, provider adapters, workflow packs, research packs, voice extensions, security packs, and business/developer packs without turning XR core into a monolith.

The platform is intentionally conservative:

- install is explicit;
- enable is explicit;
- permissions are declared in `xr-plugin.json` and granted by the user;
- manifests are inspectable before install and no plugin code runs during inspect;
- enabled plugins can be disabled or removed at any time;
- plugin tools are namespaced and approval-gated by default;
- sensitive grants force tool approval even if plugin code asks to opt out;
- entrypoint and whole-tree hashes are recorded at install and checked at load;
- broken plugins fail closed and do not crash XR.

## CLI

```bash
xr plugins list
xr plugins search github
xr plugins inspect ./plugins/hello
xr plugins install ./plugins/hello
xr plugins install hello --yes
xr plugins enable hello
xr plugin hello greet Ahmad
xr plugins permissions github
xr plugins permissions github --grant net
xr plugins disable hello
xr plugins remove hello
xr plugins doctor
xr doctor
```

## Manifest

Each plugin directory contains `xr-plugin.json`:

```json
{
  "schemaVersion": 1,
  "id": "github",
  "name": "GitHub",
  "version": "1.0.0",
  "author": "rrrtx",
  "description": "Look up public GitHub repositories.",
  "type": "integration",
  "entrypoint": "index.ts",
  "permissions": ["net", "secrets"],
  "capabilities": [
    { "kind": "command", "name": "repo" },
    { "kind": "tool", "name": "repo" }
  ],
  "dependencies": [],
  "compatibility": ">=1.0.0 <2.0.0",
  "apiVersion": 1,
  "source": { "kind": "builtin", "url": "https://github.com/ahmadrrrtx/xr" },
  "trustLevel": "official",
  "skillPaths": [],
  "mcpServers": []
}
```

### Plugin types

`tool`, `skill`, `integration`, `provider`, `memory`, `research`, `automation`, `ui`, `mcp`, `voice`, `security`, `business`, `developer`, `workflow`.

### Permissions

| Permission | Meaning |
| --- | --- |
| `fs:read` | Read files in the plugin private data directory only. |
| `fs:write` | Write files in the plugin private data directory only. |
| `net` | Use `host.net.fetch`; still limited by XR egress allow-list. |
| `browser` | Request browser surfaces through XR-controlled APIs. |
| `memory:read` | Recall durable memory through XR memory rules. |
| `memory:write` | Add durable memory with plugin provenance. |
| `provider` | Call the active model through XR budget/provider gates. |
| `voice` | Contribute voice behavior. |
| `control` | Request computer-control capability; confirmation gates still apply. |
| `secrets` | Read named secrets; values are not logged. |
| `ui` | Contribute declarative UI hooks. |
| `mcp` | Register MCP servers/MCP-backed tools. |
| `shell` | Reserved high-risk process access; blocked by static install scan for arbitrary imports. |

## Writing a plugin

```ts
import type { PluginHost, PluginContributions } from "../../src/plugins/types.ts";

export function activate(host: PluginHost): PluginContributions {
  return {
    commands: [
      { name: "greet", run(argv) { host.log(`hello, ${argv[0] ?? "world"}`); } }
    ],
    tools: [
      {
        name: "echo",
        description: "Echo a message.",
        requiresApproval: false,
        run(args) { return { ok: true, output: String(args.message ?? "") }; }
      }
    ],
    dispose() { host.log("disposed"); }
  };
}

export default activate;
```

Plugins should use only the `PluginHost`. Direct `node:fs`, `child_process`, raw `fetch`, `process.env`, `eval`, and similar ambient authority are blocked by install-time scanning.

## Skills

A plugin can ship skills by declaring `skillPaths`:

```json
{
  "id": "research-pack",
  "type": "skill",
  "skillPaths": ["skills"],
  "capabilities": [{ "kind": "skill", "name": "market-research" }]
}
```

XR loads plugin skills only when the plugin is enabled. They are discoverable with:

```bash
xr plugins skills
```

## MCP connectors

A plugin can register HTTP MCP servers if it requests `mcp`:

```json
{
  "id": "postgres-mcp",
  "type": "mcp",
  "permissions": ["mcp", "secrets"],
  "mcpServers": [
    {
      "id": "db",
      "transport": "http",
      "url": "http://127.0.0.1:8765/mcp",
      "apiKeyEnv": "POSTGRES_MCP_TOKEN",
      "tools": ["query"]
    }
  ]
}
```

MCP tools are wrapped as XR tools, namespaced as `mcp.<plugin>.<server>.<tool>`, approval-gated, and audited.

## Dashboard

`xr serve` exposes a local-only dashboard plugin panel that shows installed plugins, enabled state, permissions, trust level, capabilities, health, catalog search, and enable/disable/remove actions.

## Trust and recovery

- Registry: `~/.xr/plugins/registry.json`
- Installed code: `~/.xr/plugins/<id>/`
- Private plugin data: `~/.xr/plugins/<id>/data/`
- Hash checks: entrypoint hash plus whole-tree hash
- Disable: `xr plugins disable <id>`
- Remove: `xr plugins remove <id>`
- Health: `xr plugins doctor` and `xr doctor`

Current isolation is in-process with strict host capabilities and static scanning. Do not install unreviewed plugins that you would not trust as local code.

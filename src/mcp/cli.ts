/**
 * XR Stage 11 — `xr mcp` command handlers
 */

import type { Store } from "../state/db.ts";
import { banner, ok, warn, info, confirm, colors as C } from "../interfaces/cli.ts";
import { McpManager } from "./manager.ts";
import type { McpServerConfigInput } from "./types.ts";

interface Flags { json: boolean; yes: boolean; enable: boolean; rest: string[] }

function parseFlags(argv: string[]): Flags {
  const f: Flags = { json: false, yes: false, enable: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") f.json = true;
    else if (a === "--yes" || a === "-y") f.yes = true;
    else if (a === "--enable") f.enable = true;
    else f.rest.push(a);
  }
  return f;
}

function healthTag(h: string): string {
  if (h === "healthy") return C.green("● healthy");
  if (h === "disabled") return C.dim("○ disabled");
  if (h === "error") return C.red("✗ error");
  if (h === "unreachable") return C.amber("⚠ unreachable");
  return C.dim("○ " + h);
}

export async function handleMcpCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0] || "list";
  const flags = parseFlags(argv.slice(1));
  const mgr = new McpManager(store, process.cwd());

  switch (sub) {
    case "list": case "ls": case "status": return cmdList(mgr, flags);
    case "add": case "install": return cmdAdd(mgr, flags);
    case "remove": case "rm": return cmdRemove(mgr, flags);
    case "enable": return cmdEnable(mgr, flags);
    case "disable": return cmdDisable(mgr, flags);
    case "inspect": case "info": return cmdInspect(mgr, flags);
    case "permissions": return cmdPermissions(mgr, flags);
    case "tools": return cmdTools(mgr, flags);
    case "resources": return cmdResources(mgr, flags);
    case "prompts": return cmdPrompts(mgr, flags);
    case "health": case "check": return cmdHealth(mgr, flags);
    case "search": return cmdSearch(mgr, flags);
    case "update": return cmdUpdate(mgr, flags);
    case "doctor": return cmdDoctor(mgr);
    case "help": case "--help": case "-h": return printHelp();
    default:
      warn(`unknown mcp subcommand: ${sub}`);
      printHelp();
  }
}

function printHelp(): void {
  console.log(`${C.bold("xr mcp")} — MCP Platform (Stage 11)

  xr mcp list                     list installed MCP servers
  xr mcp add <id> <transport> <url|cmd>   register a new MCP server
  xr mcp inspect <id>             inspect capabilities + tools/resources/prompts
  xr mcp enable <id>              enable server
  xr mcp disable <id>             disable server
  xr mcp remove <id>              remove server cleanly
  xr mcp tools <id>               list tools from server
  xr mcp resources <id>           list resources
  xr mcp prompts <id>             list prompts
  xr mcp health [id]              run health check
  xr mcp search <query>           search registry
  xr mcp doctor                   MCP platform health

  Example:
    xr mcp add github stdio npx @modelcontextprotocol/server-github
    xr mcp add postgres http http://127.0.0.1:8765/mcp
`);
}

async function cmdList(mgr: McpManager, flags: Flags) {
  const servers = mgr.listServers();
  if (flags.json) return console.log(JSON.stringify(servers, null, 2));

  banner();
  const s = mgr.summary();
  console.log(`${C.bold("🔌 MCP Servers")} ${C.dim(`(${s.installed} installed · ${s.enabled} enabled · ${s.healthy} healthy)`)}`);

  if (!servers.length) return info("  no MCP servers. Try: xr mcp add ... or xr mcp search");

  for (const e of servers) {
    const tag = healthTag(e.health);
    console.log(`  ${tag.padEnd(18)} ${C.cyan(e.id.padEnd(26))} ${C.dim("v" + e.version)} ${C.dim(e.transport)} ${e.enabled ? C.green("enabled") : C.dim("disabled")}`);
    if (e.description) console.log(`      ${C.dim(e.description)}`);
    console.log(`      tools:${(e.tools?.length ?? 0)} resources:${(e.resources?.length ?? 0)} prompts:${(e.prompts?.length ?? 0)}  trust:${e.trustLevel}`);
  }
}

async function cmdAdd(mgr: McpManager, flags: Flags) {
  const [id, transportRaw, target] = flags.rest;
  if (!id || !transportRaw || !target) {
    return warn("usage: xr mcp add <id> <stdio|http|sse> <url-or-command>");
  }

  const transport = transportRaw as any;
  const input: McpServerConfigInput = {
    id,
    name: id,
    version: "0.1.0",
    description: `MCP server ${id}`,
    source: "manual",
    transport,
    localOrRemote: transport === "stdio" ? "local" : "remote",
    installedAt: Date.now(),
    updatedAt: Date.now(),
    enabled: flags.enable,
    trustLevel: "unknown",
    invocationCount: 0,
    declaredCapabilities: { tools: true, resources: true, prompts: true },
    declaredPermissions: [],
  };

  if (transport === "http" || transport === "sse" || transport === "streamable-http") {
    input.url = target;
  } else if (transport === "stdio") {
    const parts = target.split(" ");
    input.command = parts[0];
    input.args = parts.slice(1);
  }

  const res = await mgr.addServer(input);
  if (!res.ok) return warn(res.reason ?? "MCP operation failed");
  ok(`registered MCP server ${id}`);

  if (flags.enable) {
    mgr.enable(id);
    info("enabled. Run health check: xr mcp health " + id);
  } else {
    info("enable with: xr mcp enable " + id);
  }
}

async function cmdInspect(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  if (!id) return warn("usage: xr mcp inspect <id>");
  const r = await mgr.inspect(id);
  if (flags.json) return console.log(JSON.stringify(r, null, 2));

  banner();
  if (!r.ok || !r.entry) return warn(r.error || "not found");

  const e = r.entry;
  console.log(`${C.bold(e.name)} ${C.dim(e.id)} v${e.version}`);
  console.log(`${C.dim("transport:")} ${e.transport}   ${C.dim("source:")} ${e.source}   ${C.dim("trust:")} ${e.trustLevel}`);
  console.log(`${C.dim("health:")} ${e.health}   enabled: ${e.enabled ? C.green("yes") : C.dim("no")}`);

  if (r.capabilities) console.log(`${C.dim("capabilities:")} ${JSON.stringify(r.capabilities)}`);

  if (r.tools.length) {
    console.log(`\n${C.bold("Tools")} (${r.tools.length})`);
    r.tools.slice(0, 12).forEach(t => console.log(`  • ${t.name}  ${C.dim(t.description || "")}`));
  }
  if (r.resources.length) {
    console.log(`\n${C.bold("Resources")} (${r.resources.length})`);
    r.resources.slice(0, 8).forEach(r => console.log(`  • ${r.uri}`));
  }
  if (r.prompts.length) {
    console.log(`\n${C.bold("Prompts")} (${r.prompts.length})`);
    r.prompts.slice(0, 8).forEach(p => console.log(`  • ${p.name}`));
  }
}

async function cmdEnable(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  if (!id) return warn("xr mcp enable <id>");
  const r = mgr.enable(id);
  if (r.ok) ok(`enabled ${id}`); else warn(r.reason ?? "MCP operation failed");
}

async function cmdDisable(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  if (!id) return warn("xr mcp disable <id>");
  const r = await mgr.disable(id);
  if (r.ok) ok(`disabled ${id}`); else warn(r.reason ?? "MCP operation failed");
}

async function cmdRemove(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  if (!id) return warn("xr mcp remove <id>");
  if (!flags.yes) {
    const okc = await confirm(`Remove MCP server "${id}"?`, false);
    if (!okc) return info("cancelled");
  }
  const r = mgr.remove(id);
  if (r.ok) ok(`removed ${id}`); else warn(r.reason ?? "MCP operation failed");
}

async function cmdTools(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  if (!id) return warn("xr mcp tools <id>");
  const r = await mgr.inspect(id);
  if (!r.ok) return warn(r.error ?? "MCP operation failed");
  if (flags.json) return console.log(JSON.stringify(r.tools, null, 2));
  console.log(C.bold(`Tools from ${id}`));
  r.tools.forEach(t => console.log(`  ${t.name} — ${t.description || ""}`));
}

async function cmdResources(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  if (!id) return warn("xr mcp resources <id>");
  const r = await mgr.inspect(id);
  if (!r.ok) return warn(r.error ?? "MCP operation failed");
  if (flags.json) return console.log(JSON.stringify(r.resources, null, 2));
  console.log(C.bold(`Resources from ${id}`));
  r.resources.forEach(r => console.log(`  ${r.uri}`));
}

async function cmdPrompts(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  if (!id) return warn("xr mcp prompts <id>");
  const r = await mgr.inspect(id);
  if (!r.ok) return warn(r.error ?? "MCP operation failed");
  if (flags.json) return console.log(JSON.stringify(r.prompts, null, 2));
  console.log(C.bold(`Prompts from ${id}`));
  r.prompts.forEach(p => console.log(`  ${p.name}`));
}

async function cmdHealth(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  const reports = await mgr.healthCheck(id);
  if (flags.json) return console.log(JSON.stringify(reports, null, 2));
  banner();
  for (const rep of reports) {
    console.log(`${healthTag(rep.state)} ${C.cyan(rep.id)}  tools:${rep.toolsCount} res:${rep.resourcesCount} prompts:${rep.promptsCount}`);
    if (rep.detail) console.log(`    ${C.dim(rep.detail)}`);
  }
}

function cmdSearch(mgr: McpManager, flags: Flags) {
  const q = flags.rest.join(" ");
  const results = mgr.search(q);
  if (flags.json) return console.log(JSON.stringify(results, null, 2));
  banner();
  console.log(C.bold(`MCP search: ${q || "(all)"}`));
  if (!results.length) return info("no matches");
  for (const e of results) {
    console.log(`  ${C.cyan(e.id)}  ${e.name}  ${C.dim(e.transport)}`);
  }
}

async function cmdUpdate(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  if (!id) return warn("xr mcp update <id>");
  const entry = mgr.getServer(id);
  if (!entry) return warn("not found");
  const ins = await mgr.inspect(id);
  if (ins.ok) {
    ok(`refreshed ${id}`);
  } else {
    warn(ins.error ?? "MCP refresh failed");
  }
}

async function cmdDoctor(mgr: McpManager) {
  banner();
  const s = mgr.summary();
  console.log(`${C.bold("MCP Platform Health")}`);
  console.log(`  installed: ${s.installed}`);
  console.log(`  enabled:   ${s.enabled}`);
  console.log(`  healthy:   ${s.healthy}`);
  console.log(`  errored:   ${s.errored}`);

  const reports = await mgr.healthCheck();
  for (const r of reports) {
    console.log(`  ${healthTag(r.state)} ${r.id}`);
  }
}

async function cmdPermissions(mgr: McpManager, flags: Flags) {
  const id = flags.rest[0];
  if (!id) return warn("usage: xr mcp permissions <id>");
  const entry = mgr.getServer(id);
  if (!entry) return warn("MCP server not found");

  if (flags.json) {
    return console.log(JSON.stringify({
      id: entry.id,
      declaredPermissions: entry.declaredPermissions || [],
      trustLevel: entry.trustLevel,
      health: entry.health,
    }, null, 2));
  }

  banner();
  console.log(`${C.bold("MCP Permissions")} — ${C.cyan(entry.id)}`);
  const perms = entry.declaredPermissions || [];
  if (!perms.length) {
    console.log("  No permissions declared (safe / read-only server).");
  } else {
    for (const p of perms) {
      const sensitive = ["fs:write","net","control","secrets","shell","browser"].includes(p);
      console.log(`  ${sensitive ? C.yellow("⚠") : C.green("•")} ${p}`);
    }
  }
  console.log(`\n  Trust: ${entry.trustLevel}   Enabled: ${entry.enabled ? C.green("yes") : C.dim("no")}   Health: ${healthTag(entry.health)}`);
}

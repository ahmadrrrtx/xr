/** XR Stage 10 — `xr plugins …` command handlers. */
import type { Store } from "../state/workspace-store.ts";
import { banner, ok, warn, info, confirm, colors as C } from "../interfaces/cli.ts";
import { CORE_VERSION } from "../core/version.ts";
import { PluginManager } from "./manager.ts";
import { searchCatalog, resolveCatalogInstallSource } from "./catalog.ts";
import { PERMISSION_HELP, SENSITIVE_PERMISSIONS, isPermissionScope, type PermissionScope, type PluginManifest } from "./types.ts";

interface Flags { json: boolean; yes: boolean; enable: boolean; grant?: PermissionScope[]; rest: string[] }

function parseFlags(argv: string[]): Flags {
  const f: Flags = { json: false, yes: false, enable: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") f.json = true;
    else if (a === "--yes" || a === "-y") f.yes = true;
    else if (a === "--enable") f.enable = true;
    else if (a === "--grant") {
      const v = argv[++i] ?? "";
      f.grant = v.split(",").map((s) => s.trim()).filter((s): s is PermissionScope => isPermissionScope(s));
    } else f.rest.push(a);
  }
  return f;
}

function statusTag(kind: string): string {
  if (kind === "enabled") return C.green("● enabled");
  if (kind === "disabled") return C.dim("○ disabled");
  if (kind === "incompatible") return C.yellow("⚠ incompatible");
  if (kind === "untrusted") return C.red("✗ untrusted");
  return C.red("✗ error");
}

function permLine(p: PermissionScope, granted: boolean): string {
  const sensitive = SENSITIVE_PERMISSIONS.has(p);
  const mark = granted ? C.green("✓") : C.dim("·");
  const name = sensitive ? C.yellow(p) : C.cyan(p);
  return `    ${mark} ${name.padEnd(16)} ${C.dim(PERMISSION_HELP[p])}`;
}

function sourceText(m: PluginManifest): string {
  if (typeof m.source === "string") return m.source;
  return m.source?.url ?? m.sourceUrl ?? "local";
}

function printManifest(m: PluginManifest, granted?: PermissionScope[]): void {
  console.log(`  ${C.bold(m.name)} ${C.dim(`(${m.id})`)} ${C.dim("v" + m.version)}`);
  console.log(`  ${C.dim("type:")} ${m.type}   ${C.dim("author:")} ${m.author}   ${C.dim("trust:")} ${m.trustLevel}`);
  if (m.description) console.log(`  ${C.dim(m.description)}`);
  console.log(`  ${C.dim("compatibility:")} ${m.compatibility}  ${C.dim("apiVersion:")} ${m.apiVersion}  ${C.dim("source:")} ${sourceText(m)}`);
  if (m.capabilities.length) console.log(`  ${C.dim("capabilities:")} ${m.capabilities.map((c) => `${c.kind}:${c.name}`).join(", ")}`);
  if (m.skillPaths.length) console.log(`  ${C.dim("skills:")} ${m.skillPaths.join(", ")}`);
  if (m.mcpServers.length) console.log(`  ${C.dim("mcp:")} ${m.mcpServers.map((s) => s.id).join(", ")}`);
  if (m.dependencies.length) console.log(`  ${C.dim("dependencies:")} ${m.dependencies.join(", ")}`);
  console.log(`  ${C.bold("permissions requested:")}${m.permissions.length ? "" : C.dim(" (none)")}`);
  const grantSet = new Set(granted ?? []);
  for (const p of m.permissions) console.log(permLine(p, grantSet.has(p)));
}

export async function handlePluginsCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0] || "list";
  const flags = parseFlags(argv.slice(1));
  const mgr = new PluginManager(store, process.cwd());
  switch (sub) {
    case "list": case "ls": case "status": return cmdList(mgr, flags);
    case "search": case "find": return cmdSearch(flags);
    case "install": case "add": return cmdInstall(mgr, flags);
    case "inspect": case "info": return cmdInspect(mgr, flags);
    case "permissions": case "perms": return cmdPermissions(mgr, flags);
    case "enable": return cmdEnable(mgr, flags);
    case "disable": return cmdDisable(mgr, flags);
    case "update": case "upgrade": return cmdUpdate(mgr, flags);
    case "remove": case "uninstall": case "rm": return cmdRemove(mgr, flags);
    case "run": return cmdRun(mgr, flags);
    case "doctor": case "health": return cmdDoctor(mgr);
    case "skills": return cmdSkills(mgr, flags);
    case "help": case "--help": case "-h": return printPluginsHelp();
    default:
      warn(`unknown plugins command: ${sub}`);
      printPluginsHelp();
  }
}

function printPluginsHelp(): void {
  console.log(`${C.bold("xr plugins")} — manage XR plugins (XR core ${CORE_VERSION})

  xr plugins list                         list installed plugins
  xr plugins search [query]               search local/catalog plugin metadata
  xr plugins install <path|catalog-id>    inspect, approve, and install a plugin
  xr plugins inspect <id|path>            show manifest + permissions; runs no code
  xr plugins permissions <id>             show requested/granted permissions
  xr plugins enable <id>                  enable a plugin
  xr plugins disable <id>                 disable a plugin
  xr plugins update <id> [path]           update after review; blocks new permissions
  xr plugins remove <id>                  uninstall and delete plugin files
  xr plugins run <id> <cmd> [args...]     run a contributed command
  xr plugins skills                       list skills contributed by enabled plugins
  xr plugins doctor                       health of installed plugins

  flags: --yes/-y  --enable  --grant a,b,c  --json`);
}

async function cmdList(mgr: PluginManager, flags: Flags): Promise<void> {
  await mgr.loadEnabled();
  const health = mgr.health();
  if (flags.json) {
    console.log(JSON.stringify(health.map((h) => ({ id: h.entry.id, version: h.manifest?.version ?? h.entry.version, type: h.manifest?.type ?? h.entry.type, enabled: h.entry.enabled, status: h.status.kind, loaded: h.status.loaded, trustLevel: h.entry.trustLevel, granted: h.entry.grantedPermissions, capabilities: h.entry.capabilities ?? [], health: h.entry.health, detail: h.status.detail })), null, 2));
    return;
  }
  banner();
  const s = mgr.summary();
  console.log(`${C.bold("🧩 Plugins")} ${C.dim(`(${s.installed} installed · ${s.enabled} enabled · ${s.loaded} loaded · ${s.errored} need attention)`)}`);
  if (!health.length) return void info("  no plugins installed. Try: xr plugins search");
  for (const h of health) {
    const m = h.manifest;
    console.log(`  ${statusTag(h.status.kind).padEnd(24)} ${C.cyan((m?.id ?? h.entry.id).padEnd(22))} ${C.dim("v" + (m?.version ?? h.entry.version ?? "?"))} ${C.dim((m?.type ?? h.entry.type ?? "").padEnd(12))} ${C.dim(`${h.entry.grantedPermissions.length} perm(s) · ${h.entry.trustLevel ?? "unknown"}`)}`);
    if (h.status.detail) console.log(`      ${C.dim(h.status.detail)}`);
  }
}

function cmdSearch(flags: Flags): void {
  const q = flags.rest.join(" ");
  const rows = searchCatalog(q);
  if (flags.json) return void console.log(JSON.stringify(rows, null, 2));
  banner();
  console.log(`${C.bold("Plugin catalog")} ${C.dim(q ? `search: ${q}` : "local catalog")}`);
  if (!rows.length) return void info("  no matching plugins.");
  for (const e of rows) {
    const risk = e.permissions?.some((p) => SENSITIVE_PERMISSIONS.has(p as PermissionScope)) ? C.yellow("sensitive") : C.green("low-risk");
    console.log(`  ${C.cyan(e.id.padEnd(20))} ${C.bold(e.name)} ${C.dim("v" + e.version)} ${risk}`);
    console.log(`      ${C.dim(e.description)}`);
    console.log(`      ${C.dim(`type:${e.type} trust:${e.trustLevel} perms:${(e.permissions ?? []).join(",") || "none"}`)}`);
  }
}

async function cmdInstall(mgr: PluginManager, flags: Flags): Promise<void> {
  let source = flags.rest[0];
  if (!source) return void warn("usage: xr plugins install <path|catalog-id> [--enable] [--yes] [--grant a,b]");
  const match = searchCatalog(source).find((e) => e.id === source);
  if (match) {
    const resolved = resolveCatalogInstallSource(match, process.cwd());
    if (!resolved) return void warn(`catalog entry ${source} is metadata-only or remote; local safe install source is not available`);
    source = resolved;
  }
  const prep = mgr.prepareInstall(source);
  if (!prep.ok || !prep.manifest) return void warn(`install failed: ${prep.reason}`);
  banner();
  console.log(C.bold("Install plugin — review before approving:\n"));
  const requested = prep.manifest.permissions;
  const toGrant = flags.grant ? requested.filter((p) => flags.grant!.includes(p)) : requested;
  printManifest(prep.manifest, toGrant);
  if (prep.warnings?.length) console.log(`\n  ${C.yellow("warnings:")} ${prep.warnings.join("; ")}`);
  const sensitive = toGrant.filter((p) => SENSITIVE_PERMISSIONS.has(p));
  if (sensitive.length) console.log(`\n  ${C.yellow("⚠ sensitive permissions:")} ${sensitive.join(", ")}`);
  if (!flags.yes) {
    console.log();
    const approved = await confirm(`Install "${prep.manifest.id}" with ${toGrant.length} permission(s)?`, false);
    if (!approved) return void info("install cancelled.");
  }
  const res = mgr.commitInstall(source, toGrant, { enable: flags.enable });
  if (!res.ok) return void warn(`install failed: ${res.reason}`);
  ok(`installed ${prep.manifest.id} v${prep.manifest.version}${flags.enable ? " (enabled)" : ""}`);
  if (!flags.enable) info(`enable it with: xr plugins enable ${prep.manifest.id}`);
}

function cmdInspect(mgr: PluginManager, flags: Flags): void {
  const target = flags.rest[0];
  if (!target) return void warn("usage: xr plugins inspect <id|path>");
  const r = mgr.inspect(target);
  if (flags.json) return void console.log(JSON.stringify(r, null, 2));
  banner();
  if (!r.manifest) return void warn(`cannot inspect "${target}": ${r.errors.join("; ")}`);
  printManifest(r.manifest, r.granted);
  console.log();
  console.log(`  ${C.dim("installed:")} ${r.installed ? "yes" : "no"}${r.installed ? `   ${C.dim("enabled:")} ${r.enabled ? C.green("yes") : C.dim("no")}` : ""}`);
  if (r.errors.length) console.log(`  ${C.yellow("validation:")} ${r.errors.join("; ")}`);
  else console.log(`  ${C.green("✓ valid & compatible")} ${C.dim("(XR " + CORE_VERSION + ")")}`);
  if (r.warnings.length) console.log(`  ${C.yellow("warnings:")} ${r.warnings.join("; ")}`);
}

function cmdPermissions(mgr: PluginManager, flags: Flags): void {
  const id = flags.rest[0];
  if (!id) return void warn("usage: xr plugins permissions <id|path> [--grant a,b]");
  const r = mgr.inspect(id);
  if (!r.manifest) return void warn(`cannot read "${id}": ${r.errors.join("; ")}`);
  if (flags.grant && r.installed) {
    const updated = mgr.setPermissions(r.manifest.id, flags.grant);
    if (!updated.ok) return void warn(updated.reason ?? "could not update permissions");
    ok(`updated permissions: ${(updated.granted ?? []).join(", ") || "(none)"}`);
  }
  if (flags.json) return void console.log(JSON.stringify({ id: r.manifest.id, requested: r.manifest.permissions, granted: r.granted ?? [] }, null, 2));
  console.log(`${C.bold(r.manifest.name)} ${C.dim("(" + r.manifest.id + ")")} — permissions\n`);
  if (!r.manifest.permissions.length) return void info("  this plugin requests no permissions.");
  const grantSet = new Set(r.granted ?? []);
  for (const p of r.manifest.permissions) console.log(permLine(p, grantSet.has(p)));
  console.log(`\n  ${C.dim(r.installed ? "granted:" : "not installed — requested:")} ${(r.granted ?? []).join(", ") || "(none)"}`);
}

function cmdEnable(mgr: PluginManager, flags: Flags): void {
  const id = flags.rest[0];
  if (!id) return void warn("usage: xr plugins enable <id>");
  const r = mgr.enable(id);
  if (r.ok) ok(`enabled ${id}`); else warn(`could not enable ${id}: ${r.reason}`);
}

async function cmdDisable(mgr: PluginManager, flags: Flags): Promise<void> {
  const id = flags.rest[0];
  if (!id) return void warn("usage: xr plugins disable <id>");
  const r = await mgr.disable(id);
  if (r.ok) ok(`disabled ${id}`); else warn(`could not disable ${id}: ${r.reason}`);
}

async function cmdUpdate(mgr: PluginManager, flags: Flags): Promise<void> {
  const id = flags.rest[0];
  if (!id) return void warn("usage: xr plugins update <id> [path] [--yes]");
  const src = flags.rest[1];
  const before = src ? mgr.inspect(src) : undefined;
  if (before?.manifest && !flags.yes) {
    banner();
    console.log(C.bold("Update plugin — review new manifest:\n"));
    printManifest(before.manifest, mgr.getEntry(id)?.grantedPermissions);
    const yes = await confirm(`Update "${id}" to v${before.manifest.version}?`, false);
    if (!yes) return void info("update cancelled.");
  }
  const r = mgr.update(id, src);
  if (r.ok) ok(`updated ${id} → v${r.manifest?.version}`);
  else if (r.newPermissions?.length) { warn(`update requests new permissions: ${r.newPermissions.join(", ")}`); info(`re-install to approve: xr plugins install ${src ?? "<path>"}`); }
  else warn(`update failed: ${r.reason}`);
}

async function cmdRemove(mgr: PluginManager, flags: Flags): Promise<void> {
  const id = flags.rest[0];
  if (!id) return void warn("usage: xr plugins remove <id> [--yes]");
  if (!mgr.getEntry(id)) return void warn(`plugin not installed: ${id}`);
  if (!flags.yes) {
    const sure = await confirm(`Remove plugin "${id}" and delete its files?`, false);
    if (!sure) return void info("remove cancelled.");
  }
  const r = await mgr.remove(id);
  if (r.ok) ok(`removed ${id}`); else warn(`could not remove ${id}: ${r.reason}`);
}

async function cmdRun(mgr: PluginManager, flags: Flags): Promise<void> {
  const [id, command, ...rest] = flags.rest;
  if (!id || !command) return void warn("usage: xr plugins run <id> <command> [args...]");
  await mgr.loadEnabled();
  const found = mgr.findCommand(id, command);
  if (!found) {
    warn(`no command "${command}" from enabled plugin "${id}"`);
    const lp = mgr.getLoaded().find((p) => p.id === id);
    if (lp?.contributions.commands?.length) info(`available: ${lp.contributions.commands.map((c) => c.name).join(", ")}`);
    else if (!mgr.getEntry(id)?.enabled) info(`is it enabled? try: xr plugins enable ${id}`);
    return;
  }
  try { await found.cmd.run(rest); } catch (e) { warn(`plugin command failed: ${(e as Error).message}`); }
}

async function cmdSkills(mgr: PluginManager, flags: Flags): Promise<void> {
  await mgr.loadEnabled();
  const skills = mgr.pluginSkills();
  if (flags.json) return void console.log(JSON.stringify(skills, null, 2));
  banner();
  console.log(C.bold("Plugin skills\n"));
  if (!skills.length) return void info("  no enabled plugin-contributed skills.");
  for (const s of skills) console.log(`  ${C.cyan(s.id.padEnd(28))} ${C.dim(`v${s.version} · ${s.source}`)}`);
}

async function cmdDoctor(mgr: PluginManager): Promise<void> {
  await mgr.loadEnabled();
  banner();
  const health = mgr.health();
  console.log(C.bold("🧩 Plugin Health\n"));
  if (!health.length) return void info("  no plugins installed.");
  for (const h of health) {
    console.log(`  ${statusTag(h.status.kind).padEnd(24)} ${C.cyan(h.entry.id)} ${C.dim("v" + (h.manifest?.version ?? h.entry.version ?? "?"))}`);
    if (h.status.loaded && h.status.contributions !== undefined) console.log(`      ${C.dim(h.status.contributions + " contribution(s)")}`);
    if (h.status.detail) console.log(`      ${C.yellow(h.status.detail)}`);
  }
}

export async function pluginDoctorLine(store: Store): Promise<string> {
  try {
    const mgr = new PluginManager(store, process.cwd());
    await mgr.loadEnabled();
    const health = mgr.health();
    const installed = health.length;
    const enabled = health.filter((h) => h.entry.enabled).length;
    const broken = health.filter((h) => ["error", "untrusted", "incompatible"].includes(h.status.kind)).length;
    if (installed === 0) return C.dim("none installed");
    const tag = broken ? C.yellow(`⚠ ${broken} need attention`) : C.green("✓ healthy");
    return `${tag} ${C.dim(`(${installed} installed, ${enabled} enabled)`)}`;
  } catch {
    return C.dim("unavailable");
  }
}

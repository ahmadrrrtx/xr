/**
 * XR 1.0 — `xr plugins …` command handlers.
 *
 *   xr plugins                      status + list (alias of `list`)
 *   xr plugins list [--json]        list installed plugins
 *   xr plugins install <path>       install a local plugin (shows perms, asks)
 *       --yes / -y                  skip the approval prompt (non-interactive)
 *       --enable                    enable immediately after install
 *       --grant a,b                 grant only these permissions
 *   xr plugins inspect <id|path>    show manifest + permissions + compatibility
 *   xr plugins permissions <id>     show what a plugin can access (+ granted)
 *   xr plugins enable <id>
 *   xr plugins disable <id>
 *   xr plugins update <id> [path]
 *   xr plugins remove <id> [--yes]
 *   xr plugins run <id> <cmd> ...   run a command a plugin contributes
 *   xr plugins doctor               health of all installed plugins
 *
 * Mirrors XR's other `<area>/cli.ts` handlers: thin, explicit, confirmable,
 * never prints raw secrets.
 */
import type { Store } from "../state/db.ts";
import { banner, ok, warn, info, confirm, colors as C } from "../interfaces/cli.ts";
import { PluginManager } from "./manager.ts";
import {
  PERMISSION_HELP,
  SENSITIVE_PERMISSIONS,
  isPermissionScope,
  type PermissionScope,
  type PluginManifest,
} from "./types.ts";
import { CORE_VERSION } from "../core/version.ts";

interface Flags {
  json: boolean;
  yes: boolean;
  enable: boolean;
  grant?: PermissionScope[];
  rest: string[];
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { json: false, yes: false, enable: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") f.json = true;
    else if (a === "--yes" || a === "-y") f.yes = true;
    else if (a === "--enable") f.enable = true;
    else if (a === "--grant") {
      const v = argv[++i] ?? "";
      f.grant = v
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is PermissionScope => isPermissionScope(s));
    } else f.rest.push(a);
  }
  return f;
}

function statusTag(kind: string): string {
  switch (kind) {
    case "enabled":
      return C.green("● enabled");
    case "disabled":
      return C.dim("○ disabled");
    case "incompatible":
      return C.yellow("⚠ incompatible");
    case "untrusted":
      return C.red("✗ untrusted");
    default:
      return C.red("✗ error");
  }
}

function permLine(p: PermissionScope, granted: boolean): string {
  const sensitive = SENSITIVE_PERMISSIONS.has(p);
  const mark = granted ? C.green("✓") : C.dim("·");
  const name = sensitive ? C.yellow(p) : C.cyan(p);
  return `    ${mark} ${name.padEnd(sensitive ? 22 : 14)} ${C.dim(PERMISSION_HELP[p])}`;
}

function printManifest(m: PluginManifest, granted?: PermissionScope[]): void {
  console.log(`  ${C.bold(m.name)} ${C.dim(`(${m.id})`)} ${C.dim("v" + m.version)}`);
  console.log(`  ${C.dim("type:")} ${m.type}   ${C.dim("author:")} ${m.author}`);
  if (m.description) console.log(`  ${C.dim(m.description)}`);
  console.log(`  ${C.dim("compatibility:")} ${m.compatibility}  ${C.dim("apiVersion:")} ${m.apiVersion}`);
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
    case "list":
    case "ls":
      return cmdList(mgr, flags);
    case "install":
    case "add":
      return cmdInstall(mgr, flags);
    case "inspect":
    case "info":
      return cmdInspect(mgr, flags);
    case "permissions":
    case "perms":
      return cmdPermissions(mgr, flags);
    case "enable":
      return cmdEnable(mgr, flags);
    case "disable":
      return cmdDisable(mgr, flags);
    case "update":
    case "upgrade":
      return cmdUpdate(mgr, flags);
    case "remove":
    case "uninstall":
    case "rm":
      return cmdRemove(mgr, flags);
    case "run":
      return cmdRun(mgr, flags);
    case "doctor":
    case "health":
      return cmdDoctor(mgr);
    case "help":
    case "--help":
    case "-h":
      return printPluginsHelp();
    default:
      warn(`unknown plugins command: ${sub}`);
      printPluginsHelp();
  }
}

function printPluginsHelp(): void {
  console.log(`${C.bold("xr plugins")} — manage XR plugins (XR core ${CORE_VERSION})

  xr plugins list                      list installed plugins
  xr plugins install <path> [--enable] install a local plugin (shows permissions)
  xr plugins inspect <id|path>         show manifest + permissions + compatibility
  xr plugins permissions <id>          show what a plugin can access
  xr plugins enable <id>               enable a plugin
  xr plugins disable <id>              disable a plugin
  xr plugins update <id> [path]        update from its source
  xr plugins remove <id>               uninstall a plugin
  xr plugins run <id> <cmd> [args...]  run a command a plugin contributes
  xr plugins doctor                    health of all installed plugins

  flags: --yes/-y  --enable  --grant a,b,c  --json`);
}

async function cmdList(mgr: PluginManager, flags: Flags): Promise<void> {
  await mgr.loadEnabled();
  const health = mgr.health();
  if (flags.json) {
    console.log(JSON.stringify(
      health.map((h) => ({
        id: h.entry.id,
        version: h.manifest?.version,
        type: h.manifest?.type,
        enabled: h.entry.enabled,
        status: h.status.kind,
        granted: h.entry.grantedPermissions,
        detail: h.status.detail,
      })),
      null,
      2,
    ));
    return;
  }
  banner();
  const s = mgr.summary();
  console.log(`${C.bold("🧩 Plugins")} ${C.dim(`(${s.installed} installed · ${s.enabled} enabled · ${s.loaded} loaded · ${s.errored} error)`)}`);
  if (!health.length) {
    info("  no plugins installed. Install one with: xr plugins install <path>");
    return;
  }
  for (const h of health) {
    const m = h.manifest;
    console.log(
      `  ${statusTag(h.status.kind).padEnd(24)} ${C.cyan((m?.id ?? h.entry.id).padEnd(20))} ${C.dim("v" + (m?.version ?? "?"))} ${C.dim((m?.type ?? "").padEnd(11))} ${C.dim(`${h.entry.grantedPermissions.length} perm(s)`)}`,
    );
    if (h.status.detail) console.log(`      ${C.dim(h.status.detail)}`);
  }
}

async function cmdInstall(mgr: PluginManager, flags: Flags): Promise<void> {
  const source = flags.rest[0];
  if (!source) return void warn("usage: xr plugins install <path> [--enable] [--yes] [--grant a,b]");

  const prep = mgr.prepareInstall(source);
  if (!prep.ok || !prep.manifest) return void warn(`install failed: ${prep.reason}`);

  banner();
  console.log(C.bold("Install plugin — review before approving:\n"));
  // Permissions to grant: either an explicit --grant subset, or all requested.
  const requested = prep.manifest.permissions;
  const toGrant = flags.grant
    ? requested.filter((p) => flags.grant!.includes(p))
    : requested;
  printManifest(prep.manifest, toGrant);

  const sensitive = toGrant.filter((p) => SENSITIVE_PERMISSIONS.has(p));
  if (sensitive.length) {
    console.log(`\n  ${C.yellow("⚠ sensitive permissions:")} ${sensitive.join(", ")}`);
  }

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
  if (!r.manifest) {
    warn(`cannot inspect "${target}": ${r.errors.join("; ")}`);
    return;
  }
  printManifest(r.manifest, r.granted);
  console.log();
  if (r.installed) {
    console.log(`  ${C.dim("installed:")} yes   ${C.dim("enabled:")} ${r.enabled ? C.green("yes") : C.dim("no")}`);
  } else {
    console.log(`  ${C.dim("installed:")} no`);
  }
  if (!r.ok) console.log(`  ${C.yellow("⚠ validation:")} ${r.errors.join("; ")}`);
  else console.log(`  ${C.green("✓ valid & compatible")} ${C.dim("(XR " + CORE_VERSION + ")")}`);
}

function cmdPermissions(mgr: PluginManager, flags: Flags): void {
  const id = flags.rest[0];
  if (!id) return void warn("usage: xr plugins permissions <id|path>");
  const r = mgr.inspect(id);
  if (!r.manifest) return void warn(`cannot read "${id}": ${r.errors.join("; ")}`);
  if (flags.json) {
    return void console.log(JSON.stringify({
      id: r.manifest.id,
      requested: r.manifest.permissions,
      granted: r.granted ?? [],
    }, null, 2));
  }
  console.log(`${C.bold(r.manifest.name)} ${C.dim("(" + r.manifest.id + ")")} — permissions\n`);
  if (!r.manifest.permissions.length) return void info("  this plugin requests no permissions.");
  const grantSet = new Set(r.granted ?? []);
  for (const p of r.manifest.permissions) console.log(permLine(p, grantSet.has(p)));
  if (r.installed) {
    console.log(`\n  ${C.dim("granted:")} ${(r.granted ?? []).join(", ") || "(none)"}`);
  } else {
    console.log(`\n  ${C.dim("not installed — these are the permissions it would request.")}`);
  }
}

function cmdEnable(mgr: PluginManager, flags: Flags): void {
  const id = flags.rest[0];
  if (!id) return void warn("usage: xr plugins enable <id>");
  const r = mgr.enable(id);
  if (r.ok) ok(`enabled ${id}`);
  else warn(`could not enable ${id}: ${r.reason}`);
}

async function cmdDisable(mgr: PluginManager, flags: Flags): Promise<void> {
  const id = flags.rest[0];
  if (!id) return void warn("usage: xr plugins disable <id>");
  const r = await mgr.disable(id);
  if (r.ok) ok(`disabled ${id}`);
  else warn(`could not disable ${id}: ${r.reason}`);
}

function cmdUpdate(mgr: PluginManager, flags: Flags): void {
  const id = flags.rest[0];
  if (!id) return void warn("usage: xr plugins update <id> [path]");
  const src = flags.rest[1];
  const r = mgr.update(id, src);
  if (r.ok) {
    ok(`updated ${id} → v${r.manifest?.version}`);
  } else if (r.newPermissions?.length) {
    warn(`update requests new permissions: ${r.newPermissions.join(", ")}`);
    info(`re-install to approve: xr plugins install ${src ?? "<path>"}`);
  } else {
    warn(`update failed: ${r.reason}`);
  }
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
  if (r.ok) ok(`removed ${id}`);
  else warn(`could not remove ${id}: ${r.reason}`);
}

async function cmdRun(mgr: PluginManager, flags: Flags): Promise<void> {
  const [id, command, ...rest] = flags.rest;
  if (!id || !command) return void warn("usage: xr plugins run <id> <command> [args...]");
  await mgr.loadEnabled();
  const found = mgr.findCommand(id, command);
  if (!found) {
    warn(`no command "${command}" from enabled plugin "${id}"`);
    const lp = mgr.getLoaded().find((p) => p.id === id);
    if (lp?.contributions.commands?.length) {
      info(`available: ${lp.contributions.commands.map((c) => c.name).join(", ")}`);
    } else if (!mgr.getEntry(id)?.enabled) {
      info(`is it enabled? try: xr plugins enable ${id}`);
    }
    return;
  }
  try {
    await found.cmd.run(rest);
  } catch (e) {
    warn(`plugin command failed: ${(e as Error).message}`);
  }
}

async function cmdDoctor(mgr: PluginManager): Promise<void> {
  await mgr.loadEnabled();
  banner();
  const health = mgr.health();
  console.log(C.bold("🧩 Plugin Health\n"));
  if (!health.length) return void info("  no plugins installed.");
  for (const h of health) {
    console.log(`  ${statusTag(h.status.kind).padEnd(24)} ${C.cyan(h.entry.id)} ${C.dim("v" + (h.manifest?.version ?? "?"))}`);
    if (h.status.loaded && h.status.contributions !== undefined) {
      console.log(`      ${C.dim(h.status.contributions + " contribution(s)")}`);
    }
    if (h.status.detail) console.log(`      ${C.yellow(h.status.detail)}`);
  }
}

/**
 * Compact one-line summary for `xr doctor`. Actually loads enabled plugins so
 * load-time failures (incompatibility, tamper/untrusted, activate errors) are
 * reflected — not just the static registry view.
 */
export async function pluginDoctorLine(store: Store): Promise<string> {
  try {
    const mgr = new PluginManager(store, process.cwd());
    await mgr.loadEnabled();
    const health = mgr.health();
    const installed = health.length;
    const enabled = health.filter((h) => h.entry.enabled).length;
    const broken = health.filter(
      (h) => h.status.kind === "error" || h.status.kind === "untrusted" || h.status.kind === "incompatible",
    ).length;
    if (installed === 0) return C.dim("none installed");
    const tag = broken ? C.yellow(`⚠ ${broken} need attention`) : C.green("✓ healthy");
    return `${tag} ${C.dim(`(${installed} installed, ${enabled} enabled)`)}`;
  } catch {
    return C.dim("unavailable");
  }
}

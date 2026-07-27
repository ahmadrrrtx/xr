/** XR 5.2 — Capability Ecosystem CLI. */
import type { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { colors as C, heading, ok, warn, error } from "../interfaces/cli.ts";
import { CapabilityService, type CapabilityDiscoverQuery } from "../capabilities/service.ts";
import type { CapabilityDescriptor, CapabilityType } from "../capabilities/types.ts";

type Parsed = { positional: string[]; flags: Record<string, string | boolean> };

function parse(args: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) flags[key] = args[++i];
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function bool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true" || flags[key] === "1";
}

function csv(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function printUsage(): void {
  heading("XR 5.2 Capability Ecosystem");
  console.log("  xr capabilities list [--type plugin|skill|mcp|provider|tool|workflow|integration|artifact] [--json]");
  console.log("  xr capabilities discover <task> [--local] [--max-risk tier0|tier1|tier2] [--requires scope] [--exclude scope] [--certified] [--json]");
  console.log("  xr capabilities inspect <type:id|id> [--json]");
  console.log("  xr capabilities permissions <type:id|id> [--json]");
  console.log("  xr capabilities certify <type:id|id> [--json]");
  console.log("  xr capabilities enable|disable <type:id|id>");
  console.log("  xr capabilities quarantine <type:id|id> --reason <text>");
  console.log("  xr capabilities rollback <type:id|id> [--version x.y.z]");
  console.log("  xr capabilities health [--json]");
  console.log("");
  console.log("Aliases: xr capability …");
}

function stateTag(d: CapabilityDescriptor): string {
  if (d.lifecycle.state === "quarantined") return C.red("quarantined");
  if (d.lifecycle.enabled) return C.green("enabled");
  if (d.lifecycle.installed) return C.dim("disabled");
  return C.dim(d.lifecycle.state);
}

function trustTag(d: CapabilityDescriptor): string {
  const cert = d.certification.status;
  if (cert === "verified") return C.green("verified");
  if (cert === "xr-tested" || cert === "self-tested") return C.cyan(cert);
  if (cert === "quarantined") return C.red("quarantined");
  if (d.package.signatureStatus === "unsigned") return C.amber("unsigned");
  return C.dim(cert);
}

function printLine(d: CapabilityDescriptor): void {
  console.log(`  ${C.cyan(d.id.padEnd(36))} ${stateTag(d).padEnd(18)} ${trustTag(d).padEnd(20)} ${C.dim(d.placement.riskTier.padEnd(7))} ${d.name}`);
  if (d.description) console.log(`      ${C.dim(d.description.slice(0, 120))}`);
}

function printInspect(d: CapabilityDescriptor): void {
  heading(`${d.name} (${d.id})`);
  console.log(`  type/version: ${d.type} / ${d.version}`);
  console.log(`  state:        ${stateTag(d)}  risk: ${d.placement.riskTier}  placement: ${d.placement.requested}`);
  console.log(`  publisher:    ${d.publisher.name} (${d.publisher.trustLevel}${d.publisher.verified ? ", verified" : ""})`);
  console.log(`  source:       ${d.provenance.source}${d.provenance.sourceUrl ? ` ${C.dim(d.provenance.sourceUrl)}` : ""}`);
  console.log(`  signature:    ${d.package.signatureStatus}${d.package.packageSha256 ? ` sha256=${d.package.packageSha256.slice(0, 12)}…` : ""}${d.package.treeSha256 ? ` tree=${d.package.treeSha256.slice(0, 12)}…` : ""}`);
  console.log(`  certification:${d.certification.status} (${d.certification.tests.filter((t) => t.status === "passed").length}/${d.certification.tests.length} checks passed)`);
  console.log(`  network:      ${d.network.required ? d.network.locality : "none"}${d.network.domains.length ? ` ${d.network.domains.join(", ")}` : ""}`);
  console.log(`  credentials:  ${d.credentials.required ? d.credentials.refs.join(", ") || "required" : "none"}`);
  console.log(`  dependencies: ${d.dependencies.length ? d.dependencies.map((dep) => `${dep.type}:${dep.id}${dep.optional ? "?" : ""}`).join(", ") : "none"}`);
  console.log(`  interfaces:   ${d.interfaces.length ? d.interfaces.slice(0, 16).map((i) => `${i.kind}:${i.name}`).join(", ") : "none"}`);
  console.log("\n  Declared permissions:");
  if (!d.permissions.declared.length) console.log("    none");
  for (const p of d.permissions.declared) console.log(`    - ${p.scope}${p.dangerous ? " !" : ""}${p.reason ? ` — ${p.reason}` : ""}`);
  console.log("\n  Effective authority:");
  console.log(`    effective: ${d.permissions.effective.effective.join(", ") || "none"}`);
  if (d.permissions.effective.denied.length) console.log(`    denied:    ${d.permissions.effective.denied.join(", ")}`);
  if (d.permissions.effective.undetermined) console.log(`    ${C.red("undetermined:")} ${d.permissions.effective.reason ?? "unknown"}`);
  if (d.lifecycle.quarantineReason) console.log(`\n  ${C.red("quarantine:")} ${d.lifecycle.quarantineReason}`);
  if (d.trust.evidence.length) {
    console.log("\n  Trust evidence:");
    for (const e of d.trust.evidence.slice(0, 12)) console.log(`    - ${e}`);
  }
}

export class CapabilitiesCommand implements Command {
  name = "capabilities";
  description = "inspect, discover, certify, quarantine, and control XR capabilities";
  usage = "xr capabilities [list|discover|inspect|permissions|certify|enable|disable|quarantine|rollback|health]";

  async execute(ctx: CommandContext): Promise<void> {
    const service = ctx.registry.tryResolve(Tokens.Capabilities) ?? new CapabilityService(ctx.registry.resolve(Tokens.Store), ctx.registry.resolve(Tokens.Config).get());
    const parsed = parse(ctx.args);
    const action = parsed.positional[0] ?? "list";
    const rest = parsed.positional.slice(1);
    const flags = parsed.flags;
    const json = bool(flags, "json");

    try {
      switch (action) {
        case "help":
        case "--help":
          printUsage();
          return;
        case "list":
        case "ls": {
          let rows = service.list();
          if (typeof flags.type === "string") rows = rows.filter((d) => d.type === flags.type);
          if (bool(flags, "installed")) rows = rows.filter((d) => d.lifecycle.installed);
          if (bool(flags, "enabled")) rows = rows.filter((d) => d.lifecycle.enabled);
          if (json) return console.log(JSON.stringify(rows, null, 2));
          heading(`Capabilities (${rows.length})`);
          for (const d of rows) printLine(d);
          return;
        }
        case "discover":
        case "search": {
          const task = rest.join(" ").trim();
          const q: CapabilityDiscoverQuery = {
            task,
            type: typeof flags.type === "string" ? flags.type as CapabilityType : undefined,
            requires: csv(flags.requires),
            excludesPermissions: csv(flags.exclude ?? flags.excludes),
            maxRiskTier: typeof flags["max-risk"] === "string" ? flags["max-risk"] as any : undefined,
            locality: bool(flags, "local") ? "local" : typeof flags.locality === "string" ? flags.locality as any : undefined,
            trust: csv(flags.trust),
            publisher: typeof flags.publisher === "string" ? flags.publisher : undefined,
            certified: bool(flags, "certified"),
            installedOnly: bool(flags, "installed"),
            enabledOnly: bool(flags, "enabled"),
            limit: typeof flags.limit === "string" ? Number(flags.limit) : 20,
          };
          const rows = service.discover(q);
          if (json) return console.log(JSON.stringify(rows, null, 2));
          heading(`Capability Discovery${task ? `: ${task}` : ""}`);
          for (const d of rows) printLine(d);
          if (!rows.length) warn("no capabilities matched the requested task/constraints");
          return;
        }
        case "inspect":
        case "info": {
          const id = rest[0];
          if (!id) { warn("usage: xr capabilities inspect <type:id|id>"); return; }
          const d = service.inspect(id);
          if (!d) { error(`capability not found or ambiguous: ${id}`); return; }
          if (json) return console.log(JSON.stringify(d, null, 2));
          printInspect(d);
          return;
        }
        case "permissions":
        case "authority": {
          const id = rest[0];
          if (!id) { warn("usage: xr capabilities permissions <type:id|id>"); return; }
          const p = service.permissions(id);
          if (!p) { error(`capability not found or ambiguous: ${id}`); return; }
          if (json) return console.log(JSON.stringify(p, null, 2));
          heading(`Effective Authority — ${p.id}`);
          console.log(`  risk: ${p.riskTier}  placement: ${p.placement.requested}`);
          console.log(`  declared:  ${p.effective.declared.join(", ") || "none"}`);
          console.log(`  effective: ${p.effective.effective.join(", ") || "none"}`);
          if (p.effective.denied.length) console.log(`  denied:    ${p.effective.denied.join(", ")}`);
          if (p.effective.undetermined) warn(`undetermined: ${p.effective.reason ?? "unknown"}`);
          return;
        }
        case "certify": {
          const id = rest[0];
          if (!id) { warn("usage: xr capabilities certify <type:id|id>"); return; }
          const r = service.certify(id);
          if (json) return console.log(JSON.stringify(r, null, 2));
          r.ok ? ok(`certified ${r.id}: ${r.descriptor?.certification.status}`) : warn(r.reason ?? "certification incomplete");
          return;
        }
        case "enable":
        case "disable": {
          const id = rest[0];
          if (!id) { warn(`usage: xr capabilities ${action} <type:id|id>`); return; }
          const r = action === "enable" ? await service.enable(id) : await service.disable(id);
          if (json) return console.log(JSON.stringify(r, null, 2));
          r.ok ? ok(`${action}d ${r.id}`) : error(r.reason ?? `${action} failed`);
          return;
        }
        case "quarantine": {
          const id = rest[0];
          const reason = typeof flags.reason === "string" ? flags.reason : rest.slice(1).join(" ") || "manual quarantine";
          if (!id) { warn("usage: xr capabilities quarantine <type:id|id> --reason <text>"); return; }
          const r = await service.quarantine(id, reason);
          if (json) return console.log(JSON.stringify(r, null, 2));
          r.ok ? ok(`quarantined ${r.id}`) : error(r.reason ?? "quarantine failed");
          return;
        }
        case "rollback": {
          const id = rest[0];
          if (!id) { warn("usage: xr capabilities rollback <type:id|id> [--version x.y.z]"); return; }
          const r = await service.rollback(id, typeof flags.version === "string" ? flags.version : undefined);
          if (json) return console.log(JSON.stringify(r, null, 2));
          r.ok ? ok(`rolled back ${r.id}; review/enable explicitly before use`) : error(r.reason ?? "rollback failed");
          return;
        }
        case "health": {
          const h = service.health();
          if (json) return console.log(JSON.stringify(h, null, 2));
          heading("Capability Ecosystem Health");
          console.log(`  total:       ${h.total}`);
          console.log(`  installed:   ${h.installed}`);
          console.log(`  enabled:     ${h.enabled}`);
          console.log(`  certified:   ${h.certified}`);
          console.log(`  quarantined: ${h.quarantined}`);
          for (const [type, count] of Object.entries(h.byType)) console.log(`  ${type.padEnd(12)} ${count}`);
          return;
        }
        default:
          printUsage();
      }
    } catch (e) {
      error((e as Error).message);
    }
  }
}

export class CapabilityAliasCommand extends CapabilitiesCommand {
  name = "capability";
}

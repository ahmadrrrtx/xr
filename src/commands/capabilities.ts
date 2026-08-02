/** XR 5.2 — Capability Ecosystem CLI. */
import type { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { colors as C, heading, ok, warn, error } from "../interfaces/cli.ts";
import { CapabilityService, type CapabilityDiscoverQuery } from "../platform/capabilities/service.ts";
import type { CapabilityDescriptor, CapabilityType } from "../platform/capabilities/types.ts";

type Parsed = { positional: string[]; flags: Record<string, string | boolean> };

/** Compact human-readable authority diff for the CLI (Phase 7 · T4). */
function renderDiffCli(diff: import("../platform/capabilities/authority-diff.ts").AuthorityDiff): string {
  const c = diff.changes;
  const lines: string[] = [];
  lines.push(`  declared:  ${diff.next.declared.join(", ") || "none"}`);
  lines.push(`  effective: ${diff.next.effective.join(", ") || "none"}`);
  lines.push(`  denied:    ${diff.next.denied.join(", ") || "none"}`);
  lines.push(`  risk tier: ${diff.next.riskTier}${c.riskTierChanged ? ` ${C.yellow(`(was ${c.riskTierFrom})`)}` : ""}`);
  lines.push(`  data:      ${diff.next.dataScopes.join(", ") || "none"}`);
  for (const p of c.newPermissions) lines.push(`  ${C.green(`+ ${p}`)}`);
  for (const p of c.removedPermissions) lines.push(`  ${C.red(`- ${p}`)}`);
  for (const p of c.newDenied) lines.push(`  ${C.yellow(`deny ${p}`)}`);
  if (c.undetermined) lines.push(`  ${C.red("⚠ effective authority undetermined — fail closed")}`);
  if (!diff.previous) lines.push("  (first enable — no previous authority recorded)");
  return lines.join("\n");
}

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
        case "rank": {
          // Phase 7 · T3 — evidence-based ranking with "why" explanations.
          const task = rest.join(" ").trim();
          const q: CapabilityDiscoverQuery = {
            task,
            type: typeof flags.type === "string" ? flags.type as CapabilityType : undefined,
            maxRiskTier: typeof flags["max-risk"] === "string" ? flags["max-risk"] as any : undefined,
            locality: bool(flags, "local") ? "local" : undefined,
            certified: bool(flags, "certified"),
            limit: typeof flags.limit === "string" ? Number(flags.limit) : 15,
          };
          const ranked = service.rankEvidence(q);
          if (json) {
            return console.log(JSON.stringify(ranked.map((r) => ({ id: r.descriptor.id, score: r.trust.score, evidenceScore: r.trust.evidenceScore, components: r.trust.components, reasons: r.trust.reasons })), null, 2));
          }
          heading(`Capabilities by evidence${task ? `: ${task}` : ""} (popularity never decides rank)`);
          for (const { descriptor: d, trust } of ranked) {
            const pct = Math.round(trust.score * 100);
            const sig = d.package.signatureStatus === "valid" ? "✓signed" : "unsigned";
            const cert = d.certification.status;
            console.log(`  ${String(pct).padStart(3)}%  ${d.id.padEnd(42)} ${sig} · ${cert} · ${d.permissions.effective.effective.length} perms`);
          }
          if (bool(flags, "why")) {
            heading("Why each ranks (evidence reasons)");
            for (const { descriptor: d, trust } of ranked) {
              console.log(`\n  ${d.id} — ${Math.round(trust.score * 100)}%`);
              for (const r of trust.reasons.slice(0, 6)) console.log(`    · ${r}`);
            }
          }
          return;
        }
        case "trust": {
          // Phase 7 · T3 — explain ONE capability's trust score.
          const id = rest[0];
          if (!id) { warn("usage: xr capabilities trust <type:id|id>"); return; }
          const explained = service.explainTrust(id, { downloads: typeof flags.downloads === "string" ? Number(flags.downloads) : undefined });
          if (!explained) { error(`capability not found or ambiguous: ${id}`); return; }
          if (json) return console.log(JSON.stringify(explained, null, 2));
          heading(`Trust evidence — ${id}`);
          console.log(`  score: ${Math.round(explained.score * 100)}%  (evidence ${Math.round(explained.evidenceScore * 100)}%, popularity factor ${(explained.popularityFactor * 100).toFixed(0)}%)`);
          for (const [k, v] of Object.entries(explained.components)) console.log(`  ${k.padEnd(12)} ${(v * 100).toFixed(0)}%`);
          console.log("  reasons:");
          for (const r of explained.reasons) console.log(`    · ${r}`);
          return;
        }
        case "security": {
          // Phase 7 · T4 — manifest security posture.
          const id = rest[0];
          if (!id) { warn("usage: xr capabilities security <type:id|id> [--strict]"); return; }
          const report = service.securityReport(id, { strict: bool(flags, "strict") });
          if (!report) { error(`capability not found or ambiguous: ${id}`); return; }
          if (json) return console.log(JSON.stringify(report, null, 2));
          const verdict = report.verdict === "reject" ? C.red("REJECT") : report.verdict === "flag" ? C.yellow("FLAG") : C.green("OK");
          heading(`Manifest security — ${id}: ${verdict}`);
          for (const c of report.checks) {
            const mark = c.verdict === "reject" ? "✗" : c.verdict === "flag" ? "!" : "✓";
            console.log(`  ${mark} ${c.name}: ${c.detail}`);
          }
          return;
        }
        case "diff": {
          // Phase 7 · T4 — human-readable authority diff (pre-enable/update).
          const id = rest[0];
          if (!id) { warn("usage: xr capabilities diff <type:id|id>"); return; }
          const md = service.authorityDiffMarkdown(id);
          if (!md) { error(`capability not found or ambiguous: ${id}`); return; }
          if (json) {
            const diff = service.authorityDiff(id);
            return console.log(JSON.stringify(diff, null, 2));
          }
          console.log(md);
          return;
        }
        case "update": {
          // Phase 7 · T2+T4 — TUF-gated update with authority diff shown pre-apply.
          const id = rest[0];
          const source = rest[1];
          if (!id || !source) { warn("usage: xr capabilities update <type:id|id> <source-dir|.xrs|plugin-dir> [--tuf-metadata <path>] [--allow-unsigned] [--force]"); return; }
          let metadata: import("../platform/capabilities/updates.ts").TufMetadataSet | undefined;
          const tufPath = typeof flags["tuf-metadata"] === "string" ? flags["tuf-metadata"] : undefined;
          if (tufPath) {
            const { readFileSync } = await import("node:fs");
            metadata = JSON.parse(readFileSync(tufPath, "utf8")) as import("../platform/capabilities/updates.ts").TufMetadataSet;
          }
          const r = await service.update(id, source, {
            metadata,
            allowUnsigned: bool(flags, "allow-unsigned"),
            force: bool(flags, "force"),
          });
          if (json) return console.log(JSON.stringify(r, null, 2));
          if (r.diff) {
            heading(`Authority diff — ${id}`);
            console.log(renderDiffCli(r.diff));
          }
          if (r.security && r.security.verdict !== "ok") {
            heading("Manifest security (candidate)");
            for (const c of r.security.checks) if (c.verdict !== "ok") console.log(`  ${c.verdict === "reject" ? "✗" : "!"} ${c.name}: ${c.detail}`);
          }
          if (r.tuf && !r.tuf.ok) {
            heading("TUF update gate");
            for (const reason of r.tuf.reasons) console.log(`  ✗ ${reason}`);
          }
          if (r.ok) ok(`update applied: ${id}; review/enable explicitly before use`);
          else error(r.reason ?? "update failed");
          return;
        }
        case "provenance": {
          // Phase 7 · T1 — provenance graph query surface.
          const id = rest[0];
          if (!id) { warn("usage: xr capabilities provenance <type:id|id>"); return; }
          const prov = service.provenanceOf(id);
          if (!prov) { error(`no provenance recorded for: ${id}`); return; }
          if (json) return console.log(JSON.stringify(prov, null, 2));
          heading(`Provenance — ${id}`);
          console.log(`  type:        ${prov.node.type}`);
          console.log(`  version:     ${prov.node.version}   publisher: ${prov.node.publisherId}`);
          console.log(`  first seen:  ${new Date(prov.summary.firstSeenAt).toISOString()}`);
          console.log(`  last seen:   ${new Date(prov.summary.lastSeenAt).toISOString()}`);
          console.log(`  installs: ${prov.summary.installs}  updates: ${prov.summary.updates}  rollbacks: ${prov.summary.rollbacks}  uses: ${prov.summary.uses} (${prov.summary.successes} ok / ${prov.summary.failures} fail)  quarantines: ${prov.summary.quarantines}`);
          if (prov.outgoing.length) {
            console.log("  edges:");
            for (const e of prov.outgoing.slice(0, 10)) console.log(`    ${e.kind} → ${e.to}${e.version ? ` @${e.version}` : ""}`);
          }
          console.log("  recent events:");
          for (const e of prov.events.slice(-8)) console.log(`    ${new Date(e.at).toISOString().slice(11, 19)} ${e.kind.padEnd(10)} ${e.detail ?? ""}${e.outcome ? ` [${e.outcome.status}]` : ""}`);
          return;
        }
        case "used": {
          // Phase 7 · T1 — "what did the agent use?"
          const since = typeof flags.since === "string" ? Number(flags.since) : undefined;
          const runId = typeof flags.run === "string" ? flags.run : undefined;
          const used = service.whatWasUsed({ runId, since, limit: typeof flags.limit === "string" ? Number(flags.limit) : 25 });
          if (json) return console.log(JSON.stringify(used, null, 2));
          if (!used.length) { warn("no capability uses recorded yet"); return; }
          heading("What the agent used (provenance)");
          for (const u of used) console.log(`  ${u.capabilityId.padEnd(42)} ${String(u.uses).padStart(4)} uses  ${u.outcomes.success} ok / ${u.outcomes.failure} fail  last ${new Date(u.lastUsedAt).toISOString().slice(11, 19)}`);
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

/**
 * XR 6.1 — Enterprise Trust and Operations CLI.
 *
 * Safe administrative and operational surfaces for policy, authority, audit,
 * SLOs, incidents, capability supply chain, backups, releases, and evidence.
 *
 * Design rules:
 *   - Read-only by default. Destructive actions require an explicit flag.
 *   - Works on `personal_local` with no organization and no control plane.
 *   - Never prints secrets; audit output is redacted by default.
 *   - Always shows WHY a policy applied, so admins and users see the same truth.
 */

import type { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { colors as C, heading, ok, warn, error } from "../interfaces/cli.ts";
import { CORE_VERSION, PLUGIN_API_VERSION } from "../core/version.ts";
import {
  createEnterpriseServices,
  resolvePolicy,
  explainPolicyKey,
  policyRule,
  rootAuthority,
  buildOperationalStatus,
  buildEvidencePack,
  renderEvidenceSummary,
  assertNoFalseCertificationClaim,
  currentCompatibility,
  validateRollback,
  listSloDefinitions,
  adaptWorkspaceAuditRows,
  POLICY_LAYER_DESCRIPTIONS,
  VISIBILITY_KEY_DESCRIPTIONS,
  NON_OVERRIDABLE_VISIBILITY_KEYS,
  SAFETY_KEY_SPECS,
  CHANNEL_DESCRIPTIONS,
  type AuditRecord,
  type EnterpriseServices,
  type PolicyLayer,
  type IncidentKind,
  type IncidentSeverity,
  type IncidentState,
  type RevocationReason,
  type ExportFormat,
  type AuthoritySubject,
} from "../enterprise/index.ts";
import type { DeploymentProfileKind } from "../enterprise/deployment/types.ts";
import { defaultProfileForEnvironment } from "../enterprise/deployment/profiles.ts";

// ── Arg parsing (mirrors src/commands/capabilities.ts) ────────────────────────

type Parsed = { positional: string[]; flags: Record<string, string | boolean> };

function parse(args: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) flags[key] = args[++i]!;
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function bool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true" || flags[key] === "1";
}

function str(flags: Record<string, string | boolean>, key: string): string | undefined {
  return typeof flags[key] === "string" ? (flags[key] as string) : undefined;
}

function csv(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function coerce(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (raw.trim() !== "" && !Number.isNaN(n)) return n;
  return raw;
}

function statusColor(s: string): string {
  switch (s) {
    case "meeting":
    case "healthy":
    case "verified":
    case "complete":
    case "supported":
    case "active":
      return C.green(s);
    case "at_risk":
    case "degraded":
    case "partial":
    case "security_only":
    case "pending_review":
    case "unverified":
      return C.amber(s);
    case "breaching":
    case "critical":
    case "corrupt":
    case "denied":
    case "failed":
    case "end_of_life":
    case "revoked":
      return C.red(s);
    default:
      return C.dim(s);
  }
}

function sevColor(s: string): string {
  if (s === "critical") return C.red(s);
  if (s === "error" || s === "high") return C.red(s);
  if (s === "warning" || s === "medium") return C.amber(s);
  return C.dim(s);
}

// ── Usage ─────────────────────────────────────────────────────────────────────

function printUsage(): void {
  heading("XR 6.1 Enterprise Trust and Operations");
  console.log("  xr enterprise status                                    operational status, SLOs, alerts");
  console.log("");
  console.log(C.dim("  Policy"));
  console.log("  xr enterprise policy layers                             explain the six policy layers");
  console.log("  xr enterprise policy show [--org id] [--workspace id]   effective policy + decision trace");
  console.log("  xr enterprise policy explain <key>                      why one key resolved as it did");
  console.log("  xr enterprise policy set <key>=<value> --layer <layer> --reason <text>");
  console.log("  xr enterprise policy bundles [--org id]                 list policy bundles");
  console.log("  xr enterprise policy rollback <bundleId> --reason <text>");
  console.log("");
  console.log(C.dim("  Authority"));
  console.log("  xr enterprise authority list [--delegate id] [--org id]");
  console.log("  xr enterprise authority effective <subjectId>           effective authority for a subject");
  console.log("  xr enterprise authority reviews                         delegations overdue for review");
  console.log("  xr enterprise authority revoke <delegationId> --reason <text>");
  console.log("");
  console.log(C.dim("  Audit"));
  console.log("  xr enterprise audit export [--format jsonl|json|csv] [--out file] [--classes a,b]");
  console.log("  xr enterprise audit verify                              verify the audit hash chain");
  console.log("  xr enterprise audit access                              who accessed audit data");
  console.log("  xr enterprise audit retention [--apply]                 evaluate retention (dry-run default)");
  console.log("  xr enterprise audit hold <place|release|list> [--reason <text>]");
  console.log("");
  console.log(C.dim("  Operations"));
  console.log("  xr enterprise slo [--json]                              SLO definitions and current status");
  console.log("");
  console.log(C.dim("  Incidents"));
  console.log("  xr enterprise incident list [--open] [--severity s]");
  console.log("  xr enterprise incident show <incidentId>");
  console.log("  xr enterprise incident declare --kind <k> --severity <s> --title <t> --summary <s>");
  console.log("  xr enterprise incident transition <id> --to <state> --detail <text>");
  console.log("  xr enterprise incident search <query>");
  console.log("");
  console.log(C.dim("  Capability supply chain"));
  console.log("  xr enterprise supplychain list                          active revocations");
  console.log("  xr enterprise supplychain revoke <capabilityId> --reason <r> --detail <text>");
  console.log("  xr enterprise supplychain check <capabilityId> [--version x.y.z]");
  console.log("  xr enterprise supplychain notices                       unacknowledged notices");
  console.log("");
  console.log(C.dim("  Backup and recovery"));
  console.log("  xr enterprise recovery verify <backupId>                verify backup integrity");
  console.log("  xr enterprise recovery drill <backupId> [--apply]       recorded restore drill");
  console.log("  xr enterprise recovery targets                          RPO/RTO assessment");
  console.log("");
  console.log(C.dim("  Release and evidence"));
  console.log("  xr enterprise release [--channel stable|lts|beta|edge]  release + support windows");
  console.log("  xr enterprise release rollback-check --from <v> --to <v>");
  console.log("  xr enterprise evidence [--json]                         certification evidence pack");
  console.log("");
  console.log("Aliases: xr ent …    Global: --json for machine-readable output");
}

// ── Command ───────────────────────────────────────────────────────────────────

export class EnterpriseCommand implements Command {
  name = "enterprise";
  description = "organization policy, authority, audit, SLOs, incidents, supply chain, recovery, and release";
  usage = "xr enterprise [status|policy|authority|audit|slo|incident|supplychain|recovery|release|evidence]";

  async execute(ctx: CommandContext): Promise<void> {
    const parsed = parse(ctx.args);
    const action = parsed.positional[0] ?? "status";
    const rest = parsed.positional.slice(1);
    const flags = parsed.flags;
    const json = bool(flags, "json");

    // Local-first default: with no explicit profile and no cloud/org config,
    // this resolves to `personal_local`, which requires no control plane.
    const profile =
      (str(flags, "profile") as DeploymentProfileKind | undefined) ??
      defaultProfileForEnvironment({
        hasNetwork: true,
        hasOrganization: Boolean(str(flags, "org")),
        hasCloudConfig: false,
        hasRemoteWorkers: false,
      });
    const services = this.buildServices(ctx, profile);

    try {
      switch (action) {
        case "help":
        case "--help":
          printUsage();
          return;
        case "status":
          return this.status(services, profile, json);
        case "policy":
          return this.policy(services, rest, flags, json);
        case "authority":
          return this.authority(services, rest, flags, json);
        case "audit":
          return this.audit(ctx, services, rest, flags, json);
        case "slo":
          return this.slo(services, json);
        case "incident":
        case "incidents":
          return this.incident(services, rest, flags, json);
        case "supplychain":
        case "supply-chain":
          return this.supplyChain(services, rest, flags, json);
        case "recovery":
        case "backup":
          return this.recovery(services, rest, flags, json);
        case "release":
          return this.release(services, rest, flags, json);
        case "evidence":
        case "certification":
          return this.evidence(profile, json);
        default:
          printUsage();
      }
    } catch (e) {
      error((e as Error).message);
    }
  }

  // ── Service wiring ──────────────────────────────────────────────────────────

  private buildServices(ctx: CommandContext, profile: DeploymentProfileKind): EnterpriseServices {
    const store = ctx.registry.tryResolve(Tokens.Store);

    const auditSink = (event: string, detail: Record<string, unknown>): void => {
      try {
        (store as { audit?: (e: string, d: Record<string, unknown>) => unknown } | undefined)?.audit?.(event, detail);
      } catch {
        /* audit is best-effort from the CLI; never fail an admin command on it */
      }
    };

    const auditSource = (): readonly AuditRecord[] => {
      try {
        // `auditChainRange` returns ascending order WITH prev_hash, which the
        // export needs to verify chain contiguity. `recentAudit` omits
        // prev_hash and reverses order, so it must not be used here.
        const rows = (
          store as { auditChainRange?: (o: { limit?: number }) => unknown[] } | undefined
        )?.auditChainRange?.({ limit: 10_000 });
        if (!Array.isArray(rows)) return [];
        return adaptWorkspaceAuditRows(rows as Parameters<typeof adaptWorkspaceAuditRows>[0]);
      } catch {
        return [];
      }
    };

    return createEnterpriseServices({
      profile,
      currentVersion: CORE_VERSION,
      audit: auditSink,
      auditSource,
    });
  }

  // ── status ──────────────────────────────────────────────────────────────────

  private status(s: EnterpriseServices, profile: DeploymentProfileKind, json: boolean): void {
    const status = buildOperationalStatus({
      profile,
      sloReports: s.slo.reportAll(),
      incidents: s.incidents.list(),
      backup: { successRate: s.recovery.backupSuccessRate() },
      recovery: { lastDrill: s.recovery.lastDrill() },
      quarantinedCapabilities: s.supplyChain.activeRevocations().length,
      revokedDelegations: s.authority.list({ state: "revoked" }).length,
    });

    if (json) return console.log(JSON.stringify(status, null, 2));

    heading(`XR Enterprise Operations — ${profile}`);
    console.log(`  overall:              ${statusColor(status.overall)}`);
    console.log(`  organization admin:   ${s.organizationAdministrationAvailable ? C.green("available") : C.dim("not applicable for this profile")}`);
    console.log(`  local autonomy:       ${s.localAutonomy ? C.green("yes — operates with no control plane") : C.amber("control plane required")}`);
    console.log("");

    const measurable = status.slos.filter((r) => r.status !== "unmeasurable" && r.status !== "not_applicable");
    console.log(`  SLOs:                 ${measurable.filter((r) => r.status === "meeting").length}/${measurable.length} meeting  ${C.dim(`(${status.slos.length - measurable.length} unmeasurable or not applicable)`)}`);
    console.log(`  open incidents:       ${status.security.openIncidents}${status.security.criticalIncidents > 0 ? C.red(` (${status.security.criticalIncidents} critical)`) : ""}`);
    console.log(`  active revocations:   ${status.security.quarantinedCapabilities}`);
    console.log(`  revoked delegations:  ${status.security.revokedDelegations}`);
    console.log(`  workers:              ${status.workers.healthy}/${status.workers.total} healthy`);
    console.log(`  backup:               ${status.backup.healthy ? C.green("healthy") : C.amber("attention needed")}`);

    if (status.alerts.length > 0) {
      console.log("");
      heading(`Alerts (${status.alerts.length})`);
      for (const a of status.alerts.slice(0, 20)) {
        console.log(`  ${sevColor(a.severity.padEnd(8))} ${C.cyan(a.component.padEnd(22))} ${a.message}`);
        if (a.remediation) console.log(`           ${C.dim(a.remediation)}`);
      }
    } else {
      console.log("");
      ok("No alert-worthy conditions.");
    }
  }

  // ── policy ──────────────────────────────────────────────────────────────────

  private policy(s: EnterpriseServices, rest: string[], flags: Record<string, string | boolean>, json: boolean): void {
    const sub = rest[0] ?? "show";
    const org = str(flags, "org");
    const workspace = str(flags, "workspace");

    if (sub === "layers") {
      if (json) return console.log(JSON.stringify({ layers: POLICY_LAYER_DESCRIPTIONS, safetyKeys: SAFETY_KEY_SPECS, visibilityInvariants: VISIBILITY_KEY_DESCRIPTIONS }, null, 2));
      heading("Policy layers (least → most specific)");
      for (const [layer, desc] of Object.entries(POLICY_LAYER_DESCRIPTIONS)) {
        console.log(`  ${C.cyan(layer.padEnd(18))} ${desc}`);
      }
      console.log("");
      heading("Safety-relevant keys (most restrictive value wins)");
      for (const spec of Object.values(SAFETY_KEY_SPECS)) {
        console.log(`  ${C.cyan(spec.key.padEnd(30))} ${C.dim(spec.description)}`);
      }
      console.log("");
      heading("User-visibility invariants (cannot be disabled by ANY layer)");
      for (const key of NON_OVERRIDABLE_VISIBILITY_KEYS) {
        console.log(`  ${C.green(key.padEnd(24))} ${C.dim(VISIBILITY_KEY_DESCRIPTIONS[key] ?? "")}`);
      }
      return;
    }

    if (sub === "bundles") {
      const bundles = s.policy.list({ organizationId: org, workspaceId: workspace });
      if (json) return console.log(JSON.stringify(bundles, null, 2));
      heading(`Policy bundles (${bundles.length})`);
      if (bundles.length === 0) return console.log(C.dim("  No policy bundles. Platform defaults and invariants still apply."));
      for (const b of bundles) {
        console.log(`  ${C.cyan(b.bundleId.padEnd(22))} v${String(b.version).padEnd(4)} ${statusColor(b.state).padEnd(20)} ${b.rules.length} rule(s)  ${b.name}`);
        console.log(`      ${C.dim(`hash=${b.contentHash.slice(0, 16)}… by ${b.createdBy}`)}`);
      }
      return;
    }

    if (sub === "rollback") {
      const bundleId = rest[1];
      const reason = str(flags, "reason");
      if (!bundleId || !reason) {
        warn("usage: xr enterprise policy rollback <bundleId> --reason <text>");
        return;
      }
      const r = s.policy.rollback(bundleId, "cli-admin", reason);
      if (json) return console.log(JSON.stringify(r, null, 2));
      r.ok ? ok(`Rolled back. Active bundle is now ${r.bundle?.bundleId ?? "none"}.`) : error(r.error ?? "rollback failed");
      return;
    }

    if (sub === "set") {
      const assignment = rest[1] ?? "";
      const eq = assignment.indexOf("=");
      const layer = (str(flags, "layer") ?? "organization") as PolicyLayer;
      const reason = str(flags, "reason");
      if (eq === -1 || !reason) {
        warn('usage: xr enterprise policy set <key>=<value> --layer <layer> --reason "<text>"');
        console.log(C.dim("  A reason is mandatory — it is shown to every user the rule affects."));
        return;
      }
      const key = assignment.slice(0, eq);
      const value = coerce(assignment.slice(eq + 1));

      const existing = s.policy.effectiveRules(org, workspace);
      const created = s.policy.create({
        name: `cli:${key}`,
        description: `Set ${key} at ${layer} via CLI`,
        rules: [...existing, policyRule({ key, value, layer, reason, authoredBy: "cli-admin", organizationId: org, workspaceId: workspace })],
        createdBy: "cli-admin",
        organizationId: org,
        workspaceId: workspace,
      });

      if (!created.ok) {
        if (json) return console.log(JSON.stringify(created, null, 2));
        error(created.error ?? "policy rejected");
        for (const o of created.validation?.rejectedOverrides ?? []) {
          console.log(`  ${C.red("rejected:")} ${o.key} at ${o.layer} — ${o.rejectedBecause}`);
        }
        return;
      }

      const activated = s.policy.activate(created.bundle!.bundleId, "cli-admin");
      if (json) return console.log(JSON.stringify(activated, null, 2));
      activated.ok
        ? ok(`Policy bundle ${activated.bundle!.bundleId} v${activated.bundle!.version} is active.`)
        : error(activated.error ?? "activation failed");
      return;
    }

    if (sub === "explain") {
      const key = rest[1];
      if (!key) {
        warn("usage: xr enterprise policy explain <key>");
        return;
      }
      const resolution = resolvePolicy(s.policy.effectiveRules(org, workspace), { organizationId: org, workspaceId: workspace });
      const ex = explainPolicyKey(resolution, key);
      if (json) return console.log(JSON.stringify(ex ?? { key, found: false }, null, 2));
      if (!ex) {
        warn(`No policy entry for '${key}'.`);
        return;
      }
      heading(ex.summary);
      for (const line of ex.detail) console.log(`  ${line}`);
      return;
    }

    // show
    const resolution = resolvePolicy(s.policy.effectiveRules(org, workspace), { organizationId: org, workspaceId: workspace });
    if (json) return console.log(JSON.stringify(resolution, null, 2));

    heading(`Effective policy${org ? ` — org ${org}` : ""}${workspace ? ` / workspace ${workspace}` : ""}`);
    for (const e of resolution.entries) {
      const tag = e.userVisible ? C.green("[user-visible]") : e.safetyRelevant ? C.amber("[safety]") : C.dim("[preference]");
      console.log(`  ${C.cyan(e.key.padEnd(30))} ${String(e.effectiveValue).padEnd(18)} ${tag} ${C.dim(`${e.reason} · ${e.winningLayer}`)}`);
    }

    if (resolution.rejectedOverrides.length > 0) {
      console.log("");
      heading(`Rejected override attempts (${resolution.rejectedOverrides.length})`);
      for (const o of resolution.rejectedOverrides) {
        console.log(`  ${sevColor(o.severity.padEnd(9))} ${C.cyan(o.key.padEnd(26))} at ${o.layer} by ${o.authoredBy}`);
        console.log(`            ${C.dim(o.rejectedBecause)}`);
      }
    }
  }

  // ── authority ───────────────────────────────────────────────────────────────

  private authority(s: EnterpriseServices, rest: string[], flags: Record<string, string | boolean>, json: boolean): void {
    const sub = rest[0] ?? "list";

    if (sub === "effective") {
      const subjectId = rest[1];
      if (!subjectId) {
        warn("usage: xr enterprise authority effective <subjectId>");
        return;
      }
      const subject: AuthoritySubject = { kind: "ai_worker", subjectId, organizationId: str(flags, "org") };
      const eff = s.authority.effectiveAuthority(subject);
      if (json) return console.log(JSON.stringify(eff, null, 2));

      heading(`Effective authority — ${subjectId}`);
      console.log(`  scopes:        ${eff.scopes.length ? eff.scopes.join(", ") : C.dim("none")}`);
      console.log(`  risk ceiling:  ${eff.maxRiskTier}`);
      console.log(`  approvals:     ${eff.requiresApprovalFor.length ? eff.requiresApprovalFor.join(", ") : C.dim("none")}`);
      console.log(`  delegations:   ${eff.viaDelegations.length}`);
      if (eff.restrictedByPolicy.length > 0) {
        console.log("");
        heading("Restricted by policy");
        for (const r of eff.restrictedByPolicy) console.log(`  ${C.amber(r.scope.padEnd(24))} ${C.dim(r.reason)}`);
      }
      return;
    }

    if (sub === "reviews") {
      const pending = s.authority.pendingReviews();
      if (json) return console.log(JSON.stringify(pending, null, 2));
      heading(`Delegations overdue for review (${pending.length})`);
      if (pending.length === 0) return console.log(C.dim("  None."));
      for (const d of pending) {
        console.log(`  ${C.cyan(d.delegationId.padEnd(22))} ${d.delegate.subjectId.padEnd(22)} ${d.scopes.length} scope(s)  ${C.dim(d.reason)}`);
      }
      return;
    }

    if (sub === "revoke") {
      const delegationId = rest[1];
      const reason = str(flags, "reason");
      if (!delegationId || !reason) {
        warn("usage: xr enterprise authority revoke <delegationId> --reason <text>");
        return;
      }
      const r = s.authority.revoke(delegationId, "cli-admin", reason);
      if (json) return console.log(JSON.stringify(r, null, 2));
      r.ok
        ? ok(`Revoked ${r.revoked.length} delegation(s) (including cascaded sub-delegations).`)
        : error(r.error ?? "revoke failed");
      return;
    }

    const rows = s.authority.list({
      delegateId: str(flags, "delegate"),
      delegatorId: str(flags, "delegator"),
      organizationId: str(flags, "org"),
    });
    if (json) return console.log(JSON.stringify(rows, null, 2));
    heading(`Delegations (${rows.length})`);
    if (rows.length === 0) return console.log(C.dim("  No delegations recorded in this session's registry."));
    for (const d of rows) {
      const state = s.authority.stateOf(d.delegationId) ?? d.state;
      console.log(`  ${C.cyan(d.delegationId.padEnd(22))} ${statusColor(state).padEnd(20)} ${d.delegator.subjectId} → ${d.delegate.subjectId}`);
      console.log(`      ${C.dim(`scopes: ${d.scopes.join(", ") || "none"} · ceiling ${d.maxRiskTier} · depth ${d.depth}`)}`);
    }
  }

  // ── audit ───────────────────────────────────────────────────────────────────

  private audit(
    ctx: CommandContext,
    s: EnterpriseServices,
    rest: string[],
    flags: Record<string, string | boolean>,
    json: boolean,
  ): void {
    const sub = rest[0] ?? "export";

    if (sub === "verify") {
      const store = ctx.registry.tryResolve(Tokens.Store) as { verifyChain?: () => { valid: boolean; brokenAt?: number }; auditCount?: () => number } | undefined;
      const result = store?.verifyChain?.() ?? { valid: false, brokenAt: undefined };
      const count = store?.auditCount?.() ?? 0;
      if (json) return console.log(JSON.stringify({ ...result, records: count }, null, 2));
      heading("Audit chain verification");
      console.log(`  records: ${count}`);
      result.valid ? ok("Hash chain verified — no tampering detected.") : error(`Chain broken at entry ${result.brokenAt ?? "unknown"}.`);
      return;
    }

    if (sub === "access") {
      const entries = s.auditExport.accessEntries();
      if (json) return console.log(JSON.stringify(entries, null, 2));
      heading(`Audit access log (${entries.length})`);
      if (entries.length === 0) return console.log(C.dim("  No audit access recorded in this session."));
      for (const e of entries) {
        console.log(`  ${new Date(e.at).toISOString()}  ${e.granted ? C.green("granted") : C.red("denied ")}  ${e.action.padEnd(8)} ${e.actorId} (${e.recordCount} records)`);
        if (e.denyReason) console.log(`      ${C.dim(e.denyReason)}`);
      }
      return;
    }

    if (sub === "retention") {
      const apply = bool(flags, "apply");
      const records = s.auditExport.export({
        requestedBy: "cli-admin",
        format: "json",
        redactionRules: [],
        reason: "retention evaluation",
      });
      const source = records.records.map((r) => ({ ...r, detail: r.detail })) as unknown as AuditRecord[];
      const run = s.retention.run(source, { dryRun: !apply, actorId: "cli-admin" });
      if (json) return console.log(JSON.stringify(run, null, 2));

      heading(`Retention run ${run.dryRun ? C.amber("(dry run)") : C.red("(APPLIED)")}`);
      console.log(`  evaluated:    ${run.evaluated}`);
      console.log(`  retained:     ${run.retained}`);
      console.log(`  archived:     ${run.archived}`);
      console.log(`  deleted:      ${run.deleted}`);
      console.log(`  hold-blocked: ${run.holdBlocked}`);
      if (run.conflicts.length > 0) {
        console.log("");
        heading(`Legal-hold conflicts (${run.conflicts.length})`);
        for (const c of run.conflicts.slice(0, 10)) console.log(`  ${C.amber(c.recordId)} — ${c.detail}`);
      }
      if (run.dryRun) console.log(C.dim("\n  Re-run with --apply to execute deletions."));
      return;
    }

    if (sub === "hold") {
      const op = rest[1] ?? "list";
      if (op === "place") {
        const reason = str(flags, "reason");
        if (!reason) {
          warn("usage: xr enterprise audit hold place --reason <text>");
          return;
        }
        const hold = s.retention.placeHold({ reason, placedBy: "cli-admin", organizationId: str(flags, "org") });
        if (json) return console.log(JSON.stringify(hold, null, 2));
        ok(`Legal hold ${hold.holdId} placed. Scheduled deletions in scope are now blocked.`);
        return;
      }
      if (op === "release") {
        const holdId = rest[2];
        if (!holdId) {
          warn("usage: xr enterprise audit hold release <holdId>");
          return;
        }
        const r = s.retention.releaseHold(holdId, "cli-admin");
        if (json) return console.log(JSON.stringify(r, null, 2));
        r.ok ? ok(`Hold ${holdId} released.`) : error(r.error ?? "release failed");
        return;
      }
      const holds = s.retention.listHolds();
      if (json) return console.log(JSON.stringify(holds, null, 2));
      heading(`Legal holds (${holds.length})`);
      if (holds.length === 0) return console.log(C.dim("  None."));
      for (const h of holds) {
        console.log(`  ${C.cyan(h.holdId.padEnd(22))} ${h.active ? C.red("active") : C.dim("released")}  ${h.reason}`);
      }
      return;
    }

    // export
    const format = (str(flags, "format") ?? "jsonl") as ExportFormat;
    const classes = csv(flags.classes);
    const result = s.auditExport.export({
      requestedBy: "cli-admin",
      organizationId: str(flags, "org"),
      workspaceId: str(flags, "workspace"),
      format,
      redactionRules: [],
      eventClasses: classes as never,
      includeRestricted: bool(flags, "include-restricted"),
      reason: str(flags, "reason") ?? "cli export",
    });

    const outPath = str(flags, "out");
    if (outPath) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { writeFileSync } = require("node:fs") as typeof import("node:fs");
        writeFileSync(outPath, result.serialized, "utf8");
      } catch (e) {
        error(`Failed to write ${outPath}: ${(e as Error).message}`);
        return;
      }
    }

    if (json) return console.log(JSON.stringify(result.manifest, null, 2));

    heading("Audit export");
    console.log(`  export id:    ${result.manifest.exportId}`);
    console.log(`  status:       ${statusColor(result.manifest.status)}`);
    console.log(`  records:      ${result.manifest.recordCount}${result.manifest.withheldCount > 0 ? C.amber(` (${result.manifest.withheldCount} withheld)`) : ""}`);
    console.log(`  redacted:     ${result.manifest.redactedFieldCount} field(s)`);
    console.log(`  chain:        ${result.manifest.chainVerified ? C.green("verified") : C.amber("filtered subset — per-record hashes preserved")}`);
    console.log(`  content hash: ${result.manifest.contentHash}`);
    if (result.manifest.incompleteReason) console.log(`  ${C.amber("note:")}         ${result.manifest.incompleteReason}`);
    if (outPath) ok(`Written to ${outPath}`);
    else console.log(C.dim("\n  Use --out <file> to write the export, or --json for the manifest."));
  }

  // ── slo ─────────────────────────────────────────────────────────────────────

  private slo(s: EnterpriseServices, json: boolean): void {
    const reports = s.slo.reportAll();
    if (json) return console.log(JSON.stringify(reports, null, 2));

    heading(`Service Level Objectives (${reports.length})`);
    for (const r of reports) {
      const measured =
        r.measured === undefined
          ? C.dim("—")
          : r.definition.unit === "ratio"
            ? `${(r.measured * 100).toFixed(2)}%`
            : `${Math.round(r.measured)}ms`;
      const target = r.definition.unit === "ratio" ? `${(r.definition.objective * 100).toFixed(2)}%` : `${r.definition.objective}ms`;
      console.log(`  ${C.cyan(r.definition.id.padEnd(30))} ${statusColor(r.status).padEnd(22)} ${measured.padStart(10)} / ${target.padEnd(10)}`);
      console.log(`      ${C.dim(r.detail)}`);
    }

    const unmeasurable = listSloDefinitions().filter((d) => !d.measurable);
    if (unmeasurable.length > 0) {
      console.log("");
      heading("Declared unmeasurable");
      for (const d of unmeasurable) console.log(`  ${C.amber(d.id.padEnd(30))} ${C.dim(d.unmeasurableReason ?? "")}`);
    }
  }

  // ── incident ────────────────────────────────────────────────────────────────

  private incident(s: EnterpriseServices, rest: string[], flags: Record<string, string | boolean>, json: boolean): void {
    const sub = rest[0] ?? "list";

    if (sub === "declare") {
      const kind = str(flags, "kind") as IncidentKind | undefined;
      const severity = (str(flags, "severity") ?? "high") as IncidentSeverity;
      const title = str(flags, "title");
      const summary = str(flags, "summary") ?? title;
      if (!kind || !title) {
        warn("usage: xr enterprise incident declare --kind <kind> --severity <sev> --title <t> --summary <s>");
        return;
      }
      const i = s.incidents.declare({
        kind,
        severity,
        title,
        summary: summary ?? title,
        detectedBy: "cli-admin",
        organizationId: str(flags, "org"),
        affected: csv(flags.affected),
      });
      if (json) return console.log(JSON.stringify(i, null, 2));
      ok(`Incident ${i.incidentId} declared (${i.kind}, ${i.severity}).`);
      if (i.userVisibleImpact) console.log(C.amber("  Users in scope must be notified — this impact cannot be suppressed."));
      return;
    }

    if (sub === "show") {
      const id = rest[1];
      const i = id ? s.incidents.get(id) : undefined;
      if (!i) {
        warn(`Incident not found: ${id ?? "(none given)"}`);
        return;
      }
      if (json) return console.log(JSON.stringify(i, null, 2));
      heading(`${i.title} (${i.incidentId})`);
      console.log(`  kind/severity:  ${i.kind} / ${sevColor(i.severity)}`);
      console.log(`  state:          ${statusColor(i.state)}`);
      console.log(`  detected:       ${new Date(i.detectedAt).toISOString()} by ${i.detectedBy}`);
      console.log(`  user-visible:   ${i.userVisibleImpact ? C.amber("yes") : "no"}`);
      console.log(`  affected:       ${i.affected.join(", ") || C.dim("none recorded")}`);
      console.log(`  evidence:       ${i.evidence.length} item(s)`);
      console.log(`  actions:        ${i.actions.length}`);
      console.log("");
      heading("Timeline");
      for (const t of i.timeline) {
        console.log(`  ${new Date(t.at).toISOString()}  ${t.action.padEnd(22)} ${C.dim(t.detail)}`);
      }
      return;
    }

    if (sub === "transition") {
      const id = rest[1];
      const to = str(flags, "to") as IncidentState | undefined;
      const detail = str(flags, "detail") ?? "";
      if (!id || !to) {
        warn("usage: xr enterprise incident transition <incidentId> --to <state> --detail <text>");
        return;
      }
      const r = s.incidents.transition(id, to, "cli-admin", detail);
      if (json) return console.log(JSON.stringify(r, null, 2));
      r.ok ? ok(`Incident ${id} is now ${r.incident!.state}.`) : error(r.error ?? "transition failed");
      return;
    }

    if (sub === "search") {
      const q = rest.slice(1).join(" ");
      const rows = s.incidents.search(q);
      if (json) return console.log(JSON.stringify(rows, null, 2));
      heading(`Incident search "${q}" (${rows.length})`);
      for (const i of rows) console.log(`  ${C.cyan(i.incidentId.padEnd(22))} ${statusColor(i.state).padEnd(20)} ${i.title}`);
      return;
    }

    const rows = s.incidents.list({
      openOnly: bool(flags, "open"),
      severity: str(flags, "severity") as IncidentSeverity | undefined,
      organizationId: str(flags, "org"),
    });
    if (json) return console.log(JSON.stringify(rows, null, 2));
    heading(`Incidents (${rows.length})`);
    if (rows.length === 0) return console.log(C.dim("  No incidents recorded."));
    for (const i of rows) {
      console.log(`  ${C.cyan(i.incidentId.padEnd(22))} ${sevColor(i.severity.padEnd(9))} ${statusColor(i.state).padEnd(20)} ${i.title}`);
    }
  }

  // ── supply chain ────────────────────────────────────────────────────────────

  private supplyChain(s: EnterpriseServices, rest: string[], flags: Record<string, string | boolean>, json: boolean): void {
    const sub = rest[0] ?? "list";

    if (sub === "revoke") {
      const target = rest[1];
      const reason = str(flags, "reason") as RevocationReason | undefined;
      const detail = str(flags, "detail") ?? "";
      if (!target || !reason) {
        warn("usage: xr enterprise supplychain revoke <capabilityId> --reason <malicious|vulnerable|compromised_publisher|abandoned|policy_violation|unverified> --detail <text>");
        return;
      }
      const r = s.supplyChain.revoke({
        scope: bool(flags, "publisher") ? "publisher" : str(flags, "range") ? "capability_version" : "capability",
        targetId: target,
        versionRange: str(flags, "range"),
        reason,
        detail,
        issuedBy: "cli-admin",
        organizationId: str(flags, "org"),
      });
      if (json) return console.log(JSON.stringify(r, null, 2));
      if (!r.ok) return error(r.error ?? "revocation failed");
      ok(`Revoked ${target}. Evidence preserved before quarantine.`);
      console.log(`  entry:    ${r.entry!.entryId}`);
      console.log(`  notices:  ${r.notices.length}`);
      if (r.incidentId) console.log(`  incident: ${r.incidentId}`);
      return;
    }

    if (sub === "check") {
      const id = rest[1];
      if (!id) {
        warn("usage: xr enterprise supplychain check <capabilityId> [--version x.y.z]");
        return;
      }
      const d = s.supplyChain.checkInstall(id, str(flags, "version"), str(flags, "publisher"));
      if (json) return console.log(JSON.stringify(d, null, 2));
      d.allowed ? ok(`Install allowed: ${d.reason}`) : error(`Install BLOCKED: ${d.reason}`);
      return;
    }

    if (sub === "notices") {
      const notices = s.supplyChain.pendingNotices(str(flags, "org"));
      if (json) return console.log(JSON.stringify(notices, null, 2));
      heading(`Unacknowledged notices (${notices.length})`);
      if (notices.length === 0) return console.log(C.dim("  None."));
      for (const n of notices) {
        console.log(`  ${sevColor(n.severity.padEnd(9))} ${C.cyan(n.capabilityId.padEnd(28))} ${n.message}`);
        console.log(`            ${C.dim(n.recommendedAction)}`);
      }
      return;
    }

    const rows = s.supplyChain.activeRevocations(str(flags, "org"));
    if (json) return console.log(JSON.stringify(rows, null, 2));
    heading(`Active revocations (${rows.length})`);
    if (rows.length === 0) return console.log(C.dim("  None."));
    for (const e of rows) {
      console.log(`  ${C.cyan(e.targetId.padEnd(28))} ${e.scope.padEnd(20)} ${sevColor(e.reason)}${e.versionRange ? C.dim(` ${e.versionRange}`) : ""}`);
      console.log(`      ${C.dim(e.detail)}`);
    }
  }

  // ── recovery ────────────────────────────────────────────────────────────────

  private recovery(s: EnterpriseServices, rest: string[], flags: Record<string, string | boolean>, json: boolean): void {
    const sub = rest[0] ?? "targets";

    if (sub === "verify") {
      const backupId = rest[1];
      if (!backupId) {
        warn("usage: xr enterprise recovery verify <backupId>");
        return;
      }
      const v = s.recovery.verify(backupId);
      if (json) return console.log(JSON.stringify(v, null, 2));
      heading(`Backup verification — ${backupId}`);
      console.log(`  status:            ${statusColor(v.status)}`);
      console.log(`  manifest hash:     ${v.manifestHashMatches ? C.green("matches") : C.red("MISMATCH")}`);
      console.log(`  components:        ${v.componentsOk}/${v.componentsChecked} ok`);
      console.log(`  credential safety: ${v.credentialSafetyChecked ? (v.credentialSafetyOk ? C.green("clean") : C.red("CREDENTIALS FOUND")) : C.dim("not checked")}`);
      for (const e of v.errors) console.log(`  ${C.red("error:")} ${e}`);
      return;
    }

    if (sub === "drill") {
      const backupId = rest[1];
      if (!backupId) {
        warn("usage: xr enterprise recovery drill <backupId> [--apply]");
        return;
      }
      const d = s.recovery.drill({ backupId, executedBy: "cli-admin", apply: bool(flags, "apply") });
      if (json) return console.log(JSON.stringify(d, null, 2));
      heading(`Recovery drill — ${d.drillId}`);
      console.log(`  result:    ${d.ok ? C.green("passed") : C.red("failed")}`);
      console.log(`  mode:      ${bool(flags, "apply") ? C.amber("APPLIED") : "dry run"}`);
      console.log(`  preflight: ${d.preflight.ok ? C.green("clean") : C.red(`${d.preflight.blockers.length} blocker(s)`)}`);
      for (const b of d.preflight.blockers) console.log(`    ${C.red("blocker:")} ${b}`);
      for (const w of d.preflight.warnings) console.log(`    ${C.amber("warning:")} ${w}`);
      if (d.outcome) console.log(`  RTO:       ${Math.round(d.outcome.rtoMs)}ms`);
      return;
    }

    const a = s.recovery.assessTargets({ lastBackupAt: undefined });
    if (json) return console.log(JSON.stringify(a, null, 2));
    heading("Recovery targets");
    console.log(`  RPO target: ${a.targets.rpoMinutes} min   measured: ${a.measuredRpoMinutes ?? C.dim("unknown")}`);
    console.log(`  RTO target: ${a.targets.rtoMinutes} min   measured: ${a.measuredRtoMinutes ?? C.dim("unknown")}`);
    console.log(`  ${C.dim(a.basis)}`);
  }

  // ── release ─────────────────────────────────────────────────────────────────

  private release(s: EnterpriseServices, rest: string[], flags: Record<string, string | boolean>, json: boolean): void {
    const compat = currentCompatibility({
      pluginApiVersion: String(PLUGIN_API_VERSION),
      capsuleSchemaVersion: "xr-6.0.0/capsule-v1",
      minUpgradeFrom: "6.0.0",
    });
    s.releases.register({ version: CORE_VERSION, channel: "stable", compatibility: compat });

    if (rest[0] === "rollback-check") {
      const from = str(flags, "from") ?? CORE_VERSION;
      const to = str(flags, "to");
      if (!to) {
        warn("usage: xr enterprise release rollback-check --from <version> --to <version>");
        return;
      }
      s.releases.register({ version: to, channel: "stable", compatibility: compat });
      const compatibility = s.releases.checkCompatibility(from, to);
      const validation = validateRollback({
        fromVersion: from,
        toVersion: to,
        compatibility,
        probe: {
          localOperationAvailable: true,
          policySafetyIntact: true,
          auditChainVerifies: true,
          backupsReadable: true,
          incidentEvidenceIntact: true,
          revocationsEnforced: true,
        },
      });
      if (json) return console.log(JSON.stringify({ compatibility, validation }, null, 2));
      heading(`Rollback ${from} → ${to}`);
      console.log(`  result: ${validation.ok ? C.green("permitted") : C.red("BLOCKED")}`);
      for (const c of validation.checks) {
        console.log(`  ${c.passed ? C.green("✓") : C.red("✗")} ${c.name.padEnd(38)} ${C.dim(c.detail)}`);
      }
      console.log(C.dim("\n  Note: invariant probes above are CLI defaults. A real rollback runs them against live state."));
      return;
    }

    const channel = str(flags, "channel");
    const rows = s.releases.list(channel as never);
    if (json) {
      return console.log(JSON.stringify(rows.map((r) => ({ ...r, window: s.releases.supportWindow(r.version) })), null, 2));
    }
    heading("Release channels");
    for (const [name, desc] of Object.entries(CHANNEL_DESCRIPTIONS)) {
      console.log(`  ${C.cyan(name.padEnd(8))} ${C.dim(desc)}`);
    }
    console.log("");
    heading(`Registered releases (${rows.length})`);
    for (const r of rows) {
      const w = s.releases.supportWindow(r.version)!;
      console.log(`  ${C.cyan(r.version.padEnd(12))} ${r.channel.padEnd(8)} ${statusColor(w.state).padEnd(22)} ${w.message}`);
    }
    console.log("");
    heading("Compatibility declared by this build");
    console.log(`  plugin API:          ${compat.pluginApiVersion}`);
    console.log(`  capsule schema:      ${compat.capsuleSchemaVersion}`);
    console.log(`  policy schema:       ${compat.policySchemaVersion}`);
    console.log(`  audit export format: ${compat.auditExportFormatVersion}`);
    console.log(`  min upgrade from:    ${compat.minUpgradeFrom}`);
  }

  // ── evidence ────────────────────────────────────────────────────────────────

  private evidence(profile: DeploymentProfileKind, json: boolean): void {
    const pack = buildEvidencePack({ xrVersion: CORE_VERSION, profile });
    const violations = assertNoFalseCertificationClaim(pack);

    if (json) return console.log(JSON.stringify({ pack, violations }, null, 2));

    console.log(renderEvidenceSummary(pack));

    console.log("");
    heading("Controls by assurance");
    for (const kind of ["technical", "operational", "external_required"] as const) {
      const rows = pack.controls.filter((c) => c.assurance === kind);
      console.log(`\n  ${C.cyan(kind)} (${rows.length})`);
      for (const c of rows) {
        const mark = c.status === "implemented" ? C.green("✓") : c.status === "partial" ? C.amber("◐") : C.red("✗");
        console.log(`    ${mark} ${c.controlId.padEnd(7)} ${c.title}`);
      }
    }

    console.log("");
    if (violations.length === 0) {
      ok("Honesty guard passed — no unsupported certification claims.");
    } else {
      error(`Honesty guard FAILED with ${violations.length} violation(s):`);
      for (const v of violations) console.log(`  ${C.red("•")} ${v}`);
    }
  }
}

export class EnterpriseAliasCommand extends EnterpriseCommand {
  name = "ent";
}

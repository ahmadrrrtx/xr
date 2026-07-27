/**
 * XR 6.1 — Enterprise CLI Commands
 *
 * Administrative commands for policy, identity, audit, SLO, incidents,
 * capabilities, backups, deployments, release state, and governance.
 * Preserves user-facing transparency and accessibility.
 */

import type { EnterpriseService } from "../enterprise/index.ts";

export function registerEnterpriseCommands(
  register: (name: string, handler: (args: string[]) => Promise<void>, help: string) => void,
  enterprise: EnterpriseService,
) {
  // ── Policy ──────────────────────────────────────────────────────────
  register(
    "enterprise:policy:list",
    async () => {
      const rules = enterprise.policy.listRules();
      console.log(`\n  Policy Rules (${rules.length}):\n`);
      for (const rule of rules) {
        console.log(`  [${rule.tier}] ${rule.id}: ${rule.effect} — ${rule.reason}`);
      }
    },
    "List all policy rules",
  );

  register(
    "enterprise:policy:bundles",
    async () => {
      const bundles = enterprise.policy.listBundles();
      console.log(`\n  Policy Bundles (${bundles.length}):\n`);
      for (const b of bundles) {
        console.log(`  ${b.id} — ${b.name} (v${b.version}): ${b.rules.length} rules`);
      }
    },
    "List policy bundles",
  );

  register(
    "enterprise:policy:eval",
    async (args: string[]) => {
      const subject = args[0] as any;
      if (!subject) { console.log("Usage: xr enterprise:policy:eval <subject>"); return; }
      const result = enterprise.policy.evaluate({
        subject,
        target: { kind: "organization", id: "*", label: "CLI" },
      });
      console.log(`\n  Subject: ${result.subject}`);
      console.log(`  Effect: ${result.effectiveEffect}`);
      if (result.denialReason) console.log(`  Denied: ${result.denialReason}`);
      console.log(`  Matched Rules: ${result.matchedRules.length}`);
    },
    "Evaluate a policy subject",
  );

  // ── Authority ───────────────────────────────────────────────────────
  register(
    "enterprise:authority:roles",
    async () => {
      const roles = enterprise.authority.listRoles();
      console.log(`\n  Enterprise Roles (${roles.length}):\n`);
      for (const r of roles) {
        const inherited = r.inherits.length ? ` (inherits: ${r.inherits.join(", ")})` : "";
        console.log(`  ${r.role} — ${r.label}${inherited}`);
      }
    },
    "List enterprise roles",
  );

  register(
    "enterprise:authority:list",
    async () => {
      const authorities = enterprise.authority.listAuthorities(true);
      console.log(`\n  Active Delegated Authorities (${authorities.length}):\n`);
      for (const a of authorities) {
        console.log(`  ${a.id}: ${a.granter} → ${a.grantee} (${a.role}) — ${a.scopedSubjects.length} subjects`);
      }
    },
    "List delegated authorities",
  );

  register(
    "enterprise:authority:reviews",
    async () => {
      const pending = enterprise.authority.getPendingReviews();
      console.log(`\n  Pending Authority Reviews (${pending.length}):\n`);
      for (const { authority, lastReview } of pending) {
        const lastDate = lastReview ? new Date(lastReview.reviewedAt).toISOString() : "never";
        console.log(`  ${authority.id}: ${authority.grantee} (${authority.role}) — last reviewed: ${lastDate}`);
      }
    },
    "List pending authority reviews",
  );

  // ── Audit ───────────────────────────────────────────────────────────
  register(
    "enterprise:audit:schedules",
    async () => {
      const schedules = enterprise.auditExport.listRetentionSchedules();
      console.log(`\n  Retention Schedules (${schedules.length}):\n`);
      for (const s of schedules) {
        console.log(`  ${s.eventClass}: ${s.durationDays}d → ${s.action} (grace: ${s.gracePeriodDays}d)`);
      }
    },
    "List audit retention schedules",
  );

  register(
    "enterprise:audit:holds",
    async () => {
      const holds = enterprise.auditExport.listLegalHolds(true);
      console.log(`\n  Active Legal Holds (${holds.length}):\n`);
      for (const h of holds) {
        console.log(`  ${h.id}: "${h.reason}" — ${h.scope.length} event classes — placed by ${h.placedBy}`);
      }
    },
    "List active legal holds",
  );

  // ── SLO ─────────────────────────────────────────────────────────────
  register(
    "enterprise:slo:list",
    async () => {
      const slos = enterprise.slo.listSLOs();
      console.log(`\n  Service Level Objectives (${slos.length}):\n`);
      for (const s of slos) {
        const enabledMarker = s.enabled ? "✓" : "✗";
        console.log(`  [${enabledMarker}] ${s.id}: ${s.name} — target: ${s.target.value}${s.target.unit}`);
      }
    },
    "List SLO definitions",
  );

  register(
    "enterprise:slo:status",
    async () => {
      const health = enterprise.slo.getOperationalHealth({});
      console.log(`\n  Operational Health: ${health.overall.toUpperCase()}\n`);
      for (const s of health.slos) {
        const meetsMarker = s.meetsTarget ? "✓" : "✗";
        console.log(`  [${meetsMarker}] ${s.slo.name}: ${s.currentValue} (target: ${s.slo.target.value}${s.slo.target.unit}) — ${s.trend}`);
      }
      if (health.issuesRequiringAttention.length > 0) {
        console.log(`\n  Issues: ${health.issuesRequiringAttention.join("; ")}`);
      }
    },
    "Show SLO status",
  );

  // ── Incidents ───────────────────────────────────────────────────────
  register(
    "enterprise:incidents:active",
    async () => {
      const active = enterprise.incident.getActiveIncidents();
      console.log(`\n  Active Incidents (${active.length}):\n`);
      for (const i of active) {
        console.log(`  ${i.id}: [${i.severity}] ${i.title} — ${i.state} (${i.class})`);
      }
    },
    "List active incidents",
  );

  register(
    "enterprise:incidents:timeline",
    async (args: string[]) => {
      const id = args[0];
      if (!id) { console.log("Usage: xr enterprise:incidents:timeline <incident-id>"); return; }
      const incident = enterprise.incident.getIncident(id);
      if (!incident) { console.log(`Incident ${id} not found`); return; }
      console.log(`\n  Incident: ${incident.title}\n`);
      for (const e of incident.timeline) {
        console.log(`  ${new Date(e.timestamp).toISOString()} — ${e.actor}: ${e.action}`);
      }
    },
    "Show incident timeline",
  );

  // ── Supply Chain ────────────────────────────────────────────────────
  register(
    "enterprise:supplychain:status",
    async () => {
      const status = enterprise.supplyChain.getStatus();
      console.log(`\n  Supply Chain Status:\n`);
      console.log(`  Active Quarantines: ${status.activeQuarantines.length}`);
      console.log(`  Blocked Publishers: ${status.blockedPublishers.length}`);
      console.log(`  Blocked Publishers List: ${status.blockedPublishers.join(", ") || "none"}`);
      for (const q of status.activeQuarantines) {
        console.log(`  Quarantined: ${q.capabilityId}${q.version ? `@${q.version}` : ""} — ${q.reason}`);
      }
    },
    "Show supply-chain status",
  );

  // ── Releases ────────────────────────────────────────────────────────
  register(
    "enterprise:release:channels",
    async () => {
      const channel = enterprise.releases.getActiveChannel();
      console.log(`\n  Active Channel: ${channel}`);
      const releases = enterprise.releases.listReleases(channel);
      console.log(`\n  Releases in ${channel}:`);
      for (const r of releases.slice(0, 10)) {
        const eol = enterprise.releases.checkEOL(r.version);
        console.log(`  ${r.version} (${new Date(r.publishedAt).toISOString().split("T")[0]})${eol.eol ? " [EOL]" : ""}`);
      }
    },
    "Show release channels",
  );

  // ── Backup/DR ───────────────────────────────────────────────────────
  register(
    "enterprise:backup:schedules",
    async () => {
      const schedules = enterprise.backup.listSchedules(true);
      console.log(`\n  Active Backup Schedules (${schedules.length}):\n`);
      for (const s of schedules) {
        console.log(`  ${s.id}: ${s.scope} — every ${s.frequencyMinutes}min, retain ${s.retentionCount}`);
      }
    },
    "List backup schedules",
  );

  register(
    "enterprise:backup:dr-plans",
    async () => {
      const plans = enterprise.backup.listDRPlans();
      console.log(`\n  Disaster Recovery Plans (${plans.length}):\n`);
      for (const p of plans) {
        const lastTested = p.lastTestedAt ? new Date(p.lastTestedAt).toISOString() : "never";
        console.log(`  ${p.name}: RPO=${p.rpoMinutes}min RTO=${p.rtoMinutes}min — last tested: ${lastTested} — result: ${p.testResult ?? "untested"}`);
      }
    },
    "List DR plans",
  );

  // ── Diagnostics ─────────────────────────────────────────────────────
  register(
    "enterprise:diagnostics:run",
    async () => {
      const latest = enterprise.diagnostics.getLatestReport();
      if (!latest) {
        console.log("No diagnostic report available. Run diagnostics first.");
        return;
      }
      console.log(`\n  Diagnostic Report — ${new Date(latest.runAt).toISOString()}`);
      console.log(`  Overall: ${latest.overallHealth.toUpperCase()}`);
      console.log(`  Summary: ${latest.summary}\n`);
      for (const d of latest.diagnostics) {
        const icon = d.status === "pass" ? "✓" : d.status === "warn" ? "⚠" : "✗";
        console.log(`  [${icon}] ${d.name}: ${d.detail}`);
      }
    },
    "Show latest diagnostic report",
  );

  // ── Security Assessment ──────────────────────────────────────────────
  register(
    "enterprise:security:evidence",
    async () => {
      const summary = enterprise.securityAssessment.prepareEvidenceSummary();
      console.log(`\n  Security Assessment Evidence Summary:\n`);
      console.log(`  Assessments: ${summary.assessmentsCompleted}`);
      console.log(`  Latest Rating: ${summary.latestRating ?? "none"}`);
      console.log(`  Open Findings: ${summary.openFindings} (${summary.criticalFindings} critical, ${summary.highFindings} high)`);
      console.log(`  Known Limitations: ${summary.limitations.length}`);
      const readiness = enterprise.securityAssessment.checkCertificationReadiness();
      console.log(`  Certification Ready: ${readiness.ready ? "Yes" : "No"}`);
      if (readiness.blockers.length) {
        console.log(`  Blockers: ${readiness.blockers.join("; ")}`);
      }
    },
    "Show security assessment evidence",
  );

  // ── Governance ──────────────────────────────────────────────────────
  register(
    "enterprise:governance:proposals",
    async () => {
      const summary = enterprise.governance.getProposalSummary();
      console.log(`\n  Governance Proposals:`);
      console.log(`  Open: ${summary.open}  Accepted: ${summary.accepted}  Rejected: ${summary.rejected}  Implemented: ${summary.implemented}`);
      const open = enterprise.governance.listProposals({ status: "open" });
      for (const p of open) {
        console.log(`  ${p.id}: "${p.title}" (${p.category}) — votes: ${p.votes.length}`);
      }
    },
    "List governance proposals",
  );

  register(
    "enterprise:governance:exceptions",
    async () => {
      const exceptions = enterprise.governance.listExceptions(true);
      console.log(`\n  Active Architecture Exceptions (${exceptions.length}):\n`);
      for (const e of exceptions) {
        const nextReview = new Date(e.reviewDate).toISOString().split("T")[0];
        console.log(`  ${e.id}: ${e.invariant} — owner: ${e.owner} — next review: ${nextReview}`);
      }
    },
    "List architecture exceptions",
  );

  // ── Disclaimer ──────────────────────────────────────────────────────
  register(
    "enterprise:disclaimer",
    async () => {
      console.log(`\n  ${enterprise.getCertificationDisclaimer()}\n`);
    },
    "Show certification disclaimer",
  );
}

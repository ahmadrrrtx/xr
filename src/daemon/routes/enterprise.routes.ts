/**
 * XR 6.1 — Enterprise Trust & Operations Daemon Routes
 *
 * Exposes enterprise administration endpoints for the self-hosted dashboard.
 * All routes require admin authentication. Preserves user-facing transparency.
 */

import type { EnterpriseService } from "../../enterprise/index.ts";

export function registerEnterpriseRoutes(
  app: { get: (path: string, handler: (req: any, res: any) => Promise<void><void>) => void },
  enterprise: EnterpriseService,
) {
  // ── Health ───────────────────────────────────────────────────────────
  app.get("/api/enterprise/health", async (_req: any, res: any) => {
    const health = enterprise.slo.getOperationalHealth({
      activeIncidents: enterprise.incident.countActive(),
      unresolvedVulnerabilities: enterprise.vulnerability.countUnresolved(),
    });
    res.json({ ok: true, data: health });
  });

  // ── Policy ───────────────────────────────────────────────────────────
  app.get("/api/enterprise/policy/rules", async (_req: any, res: any) => {
    const rules = enterprise.policy.listRules();
    res.json({ ok: true, data: rules });
  });

  app.get("/api/enterprise/policy/bundles", async (_req: any, res: any) => {
    const bundles = enterprise.policy.listBundles();
    res.json({ ok: true, data: bundles });
  });

  // ── Authority ────────────────────────────────────────────────────────
  app.get("/api/enterprise/authority/roles", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.authority.listRoles() });
  });

  app.get("/api/enterprise/authority/list", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.authority.listAuthorities(true) });
  });

  // ── Audit ────────────────────────────────────────────────────────────
  app.get("/api/enterprise/audit/schedules", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.auditExport.listRetentionSchedules() });
  });

  app.get("/api/enterprise/audit/holds", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.auditExport.listLegalHolds(true) });
  });

  // ── SLOs ─────────────────────────────────────────────────────────────
  app.get("/api/enterprise/slo/list", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.slo.listSLOs() });
  });

  app.get("/api/enterprise/slo/status", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.slo.evaluateAll() });
  });

  // ── Incidents ────────────────────────────────────────────────────────
  app.get("/api/enterprise/incidents", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.incident.listIncidents() });
  });

  app.get("/api/enterprise/incidents/active", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.incident.getActiveIncidents() });
  });

  // ── Supply Chain ─────────────────────────────────────────────────────
  app.get("/api/enterprise/supplychain/status", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.supplyChain.getStatus() });
  });

  // ── Releases ─────────────────────────────────────────────────────────
  app.get("/api/enterprise/releases/channels", async (_req: any, res: any) => {
    res.json({
      ok: true,
      data: {
        active: enterprise.releases.getActiveChannel(),
        releases: enterprise.releases.listReleases(),
      },
    });
  });

  // ── Backup/DR ────────────────────────────────────────────────────────
  app.get("/api/enterprise/backup/schedules", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.backup.listSchedules(true) });
  });

  app.get("/api/enterprise/backup/dr-plans", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.backup.listDRPlans() });
  });

  // ── Diagnostics ──────────────────────────────────────────────────────
  app.get("/api/enterprise/diagnostics/latest", async (_req: any, res: any) => {
    const latest = enterprise.diagnostics.getLatestReport();
    res.json({ ok: true, data: latest });
  });

  // ── Security Assessment ──────────────────────────────────────────────
  app.get("/api/enterprise/security/evidence", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.securityAssessment.prepareEvidenceSummary() });
  });

  // ── Governance ───────────────────────────────────────────────────────
  app.get("/api/enterprise/governance/proposals", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.governance.getProposalSummary() });
  });

  app.get("/api/enterprise/governance/exceptions", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.governance.listExceptions(true) });
  });

  // ── Certification Disclaimer ─────────────────────────────────────────
  app.get("/api/enterprise/disclaimer", async (_req: any, res: any) => {
    res.json({ ok: true, data: enterprise.getCertificationDisclaimer() });
  });
}

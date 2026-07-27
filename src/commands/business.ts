/**
 * XR — Business OS Command — XR 5.3 Personal and Business Operating Layer
 * Provides `xr business` and `xr biz` access to the Business OS with outcome-centered views:
 * - work queues
 * - active workflows
 * - AI worker status
 * - approvals/escalations
 * - records changed
 * - evidence/artifacts
 * - cost/time
 * - failures/recovery
 * - audit/provenance
 *
 * Supports personal, developer, researcher, operator, business experiences.
 * No Phase 11 control plane.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { BusinessOS } from "../business/index.ts";
import { banner, ok, info, warn, xrBold, xrDim, xrGreen, xrRed } from "../cli/output.ts";
import { xrAmber } from "../ui/theme.ts";
const xrYellow = xrAmber;

function isJsonFlag(args: string[]): boolean {
  return args.includes('--json') || args.includes('-j');
}

function getWorkspaceId(args: string[], fallback = 'default'): string {
  const idx = args.indexOf('--workspace');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  const idx2 = args.indexOf('-w');
  if (idx2 !== -1 && args[idx2 + 1]) return args[idx2 + 1];
  return fallback;
}

function getOrgId(args: string[], fallback = 'default-org'): string {
  const idx = args.indexOf('--org');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

export class BusinessCommand implements Command {
  name = "business";
  description = "XR Business OS commands — XR 5.3 Personal and Business Operating Layer";
  usage = "xr business [status|init|journeys|outcomes|approvals|workers|artifacts|mutations|privacy|work-queue|audit]";

  async execute(ctx: CommandContext): Promise<void> {
    const businessOS = ctx.registry.resolve(Tokens.Business) as BusinessOS;
    const rawArgs = ctx.args ?? [];
    const sub = rawArgs[0] ?? "status";
    const json = isJsonFlag(rawArgs);
    const workspaceId = getWorkspaceId(rawArgs);
    const orgId = getOrgId(rawArgs);

    if (!businessOS) {
      console.log(`${xrBold("Business OS")} ${xrDim("— not available")}`);
      return;
    }

    // ── status ────────────────────────────────────────────────────────
    if (sub === "status") {
      if (!businessOS.isInitialized()) {
        if (json) {
          console.log(JSON.stringify({ initialized: false, workspaceId, orgId }));
        } else {
          console.log(`${xrBold("Business OS")} ${xrDim("— not initialized")}`);
          console.log(`Enable with: ${xrDim("config.business.enabled = true")}`);
        }
        return;
      }

      const health = businessOS.getHealth();
      const opStats = businessOS.db.getOperatingLayerStats();
      const journeys = businessOS.operatingLayer.listJourneys();
      const outcomes = businessOS.outcomes.getStats(workspaceId);
      const approvals = businessOS.approvals.listPending(workspaceId);
      const privacy = businessOS.privacy.getPolicy(workspaceId);

      if (json) {
        console.log(JSON.stringify({
          initialized: true,
          version: businessOS.getVersion(),
          health: health.status,
          tables: health.stats,
          operatingLayerTables: opStats,
          journeys: journeys.length,
          outcomes,
          pendingApprovals: approvals.length,
          privacyMode: privacy?.mode ?? 'private',
        }, null, 2));
        return;
      }

      banner();
      console.log(`  ${xrBold("Business OS")} ${xrDim("v" + businessOS.getVersion().version)} XR 5.3`);
      console.log(`  ${xrDim("─".repeat(52))}`);
      console.log(`  Status ........ ${xrGreen(health.status)}`);
      console.log(`  Workspace ..... ${workspaceId}`);
      console.log(`  Org ........... ${orgId}`);
      console.log(`  Tables ........ ${Object.values(health.stats).filter((v) => v > 0).length} active (${Object.keys(health.stats).length} total)`);
      console.log(`  OpLayer Tables  ${Object.values(opStats).filter((v: any) => v >= 0).length} (incl. outcomes, mutations, artifacts, approvals)`);
      console.log(`  Journeys ...... ${journeys.length} (${journeys.map(j => j.id).join(', ').slice(0, 80)})`);
      console.log(`  Outcomes ...... total ${outcomes.total} verified ${outcomes.verified} failed ${outcomes.failed} pending ${outcomes.pending}`);
      console.log(`  Pending Approve ${approvals.length}`);
      console.log(`  Privacy Mode .. ${privacy?.mode ?? 'private'}${privacy?.mode === 'local' ? ' (local-only)' : ''}`);
      console.log(`  Cost Today .... $${outcomes.totalCost.toFixed(2)} avgDuration ${outcomes.avgDurationMs}ms`);
      console.log(`\n  ${xrDim("Use")} ${xrBold("xr business journeys list --json")} ${xrDim("to see outcome-oriented journeys")}`);
      console.log(`  ${xrDim("Use")} ${xrBold("xr business work-queue")} ${xrDim("for work queues, approvals, active workflows")}`);
      console.log(`  ${xrDim("Use")} ${xrBold("xr biz workers list")} ${xrDim("for AI worker status")}`);
      return;
    }

    if (sub === "init") {
      await businessOS.initialize();
      if (json) {
        console.log(JSON.stringify({ ok: true, tables: Object.keys(businessOS.db.getStats()).length }));
      } else {
        ok("Business OS initialized successfully.");
        console.log(`  Journeys: ${businessOS.operatingLayer.listJourneys().length}`);
      }
      return;
    }

    // ── journeys ──────────────────────────────────────────────────────
    if (sub === "journeys" || sub === "journey") {
      const action = rawArgs[1] ?? "list";
      if (action === "list") {
        const journeys = businessOS.operatingLayer.listJourneys();
        if (json) {
          console.log(JSON.stringify({ journeys, count: journeys.length }, null, 2));
        } else {
          console.log(`${xrBold("Outcome-Oriented Journeys")} (${journeys.length})`);
          console.log(xrDim("─".repeat(60)));
          for (const j of journeys) {
            console.log(`  ${xrGreen(j.id)} [${j.category}] v${j.version} ${j.active ? '' : xrRed('(inactive)')}`);
            console.log(`    ${j.name} — ${j.description.slice(0, 100)}`);
            console.log(`    Trigger: ${j.trigger.kind}${j.trigger.eventType ? ` ${j.trigger.eventType}` : ''} | Workflow: ${j.workflow.definitionId} v${j.workflow.version} | Privacy: ${j.privacy}`);
            console.log(`    Nodes: ${j.workflow.nodes.map(n => `${n.id}:${n.kind}`).join(' → ').slice(0, 100)}`);
            console.log(`    Outcome: ${j.outcomes.verifiedOutcomeType} metrics=${j.outcomes.metrics.join(',')} cost=$${j.outcomes.costBudget.maxUsd}`);
            console.log('');
          }
        }
        return;
      }
      if (action === "start") {
        const journeyId = rawArgs[2];
        if (!journeyId) {
          console.log(`Usage: xr business journeys start <journeyId> [--workspace <id>] [--json] [--input '<json>']`);
          return;
        }
        // Parse input JSON
        let input: Record<string, unknown> = {};
        const inputIdx = rawArgs.indexOf('--input');
        if (inputIdx !== -1 && rawArgs[inputIdx + 1]) {
          try { input = JSON.parse(rawArgs[inputIdx + 1]); } catch {}
        }
        try {
          const result = await businessOS.operatingLayer.startJourney({
            journeyId,
            workspaceId,
            orgId,
            actorId: 'cli-user',
            input,
          });
          if (json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            ok(`Journey ${journeyId} started`);
            console.log(`  RunId: ${result.runId}`);
            console.log(`  OutcomeId: ${result.outcomeId}`);
            console.log(`  Title: ${result.journey.name}`);
          }
        } catch (e) {
          if (json) {
            console.log(JSON.stringify({ error: (e as Error).message }, null, 2));
          } else {
            warn((e as Error).message);
          }
        }
        return;
      }
      if (action === "show") {
        const journeyId = rawArgs[2];
        if (!journeyId) {
          console.log(`Usage: xr business journeys show <journeyId>`);
          return;
        }
        const journey = businessOS.operatingLayer.getJourney(journeyId);
        if (!journey) {
          console.log(`Journey not found: ${journeyId}`);
          return;
        }
        if (json) {
          console.log(JSON.stringify(journey, null, 2));
        } else {
          console.log(`${xrBold(journey.id)} — ${journey.name}`);
          console.log(xrDim(JSON.stringify(journey, null, 2).slice(0, 2000)));
        }
        return;
      }
    }

    // ── outcomes ──────────────────────────────────────────────────────
    if (sub === "outcomes" || sub === "outcome") {
      const action = rawArgs[1] ?? "list";
      if (action === "list") {
        const outcomes = businessOS.outcomes.listByWorkspace(workspaceId, { limit: 20 });
        const stats = businessOS.outcomes.getStats(workspaceId);
        if (json) {
          console.log(JSON.stringify({ outcomes, stats }, null, 2));
        } else {
          console.log(`${xrBold("Outcomes")} workspace=${workspaceId} total=${stats.total} verified=${stats.verified} failed=${stats.failed} pending=${stats.pending}`);
          console.log(xrDim("─".repeat(60)));
          for (const o of outcomes) {
            const color = o.status === 'verified' ? xrGreen : o.status === 'failed' ? xrRed : xrYellow;
            console.log(`  ${color(o.status)} ${o.outcomeId} ${o.journeyId} ${o.title}`);
            console.log(`    Records: ${o.recordsChanged.length} Artifacts: ${o.artifacts.length} Cost: $${o.cost.actualUsd} Duration: ${o.cost.durationMs}ms`);
            console.log(`    ${o.summary.slice(0, 120)}`);
          }
          console.log(`\n  Total cost $${stats.totalCost.toFixed(2)} avg ${stats.avgDurationMs}ms`);
        }
        return;
      }
      if (action === "show") {
        const outcomeId = rawArgs[2];
        if (!outcomeId) {
          console.log(`Usage: xr business outcomes show <outcomeId>`);
          return;
        }
        const view = businessOS.operatingLayer.getOutcomeView(outcomeId);
        if (!view) {
          console.log(`Outcome not found: ${outcomeId}`);
          return;
        }
        if (json) {
          console.log(JSON.stringify(view, null, 2));
        } else {
          console.log(`${xrBold(view.outcomeId)} ${view.journeyId} ${xrGreen(view.status)}`);
          console.log(`  Title: ${view.title}`);
          console.log(`  Summary: ${view.summary}`);
          console.log(`  WorkflowRun: ${view.workflowRunId}`);
          console.log(`  Records changed: ${view.recordsChanged.map(r => `${r.module}/${r.entity}/${r.id}:${r.operation}`).join(', ')}`);
          console.log(`  Artifacts: ${view.artifacts.length} Evidence: ${view.evidenceRefs.length}`);
          console.log(`  Cost: est $${view.cost.estimatedUsd} actual $${view.cost.actualUsd} tokens ${view.cost.tokensIn}/${view.cost.tokensOut} duration ${view.cost.durationMs}ms`);
          console.log(`  Metrics: ${view.metrics.map(m => `${m.name}=${m.value}`).join(', ')}`);
          console.log(`  Verified: ${view.verifiedAt ?? 'not yet'} by ${view.verifiedBy ?? '-'}`);
          if (view.failureReason) console.log(xrRed(`  Failure: ${view.failureReason}`));
          if (view.artifactsDetail?.length) {
            console.log(`  Artifacts detail:`);
            for (const art of view.artifactsDetail) {
              console.log(`    - ${art.artifactId} ${art.contract.kind}/${art.contract.name} hash=${art.contentHash.slice(0, 12)} sensitivity=${art.sensitivity}`);
            }
          }
          if (view.approvals?.length) {
            console.log(`  Linked approvals: ${view.approvals.length}`);
            for (const apr of view.approvals) {
              console.log(`    - ${apr.approvalId} ${apr.kind} ${apr.status} ${apr.title}`);
            }
          }
        }
        return;
      }
    }

    // ── approvals / work-queue ────────────────────────────────────────
    if (sub === "approvals" || sub === "approval" || sub === "work-queue" || sub === "workqueue" || sub === "queue") {
      const pending = businessOS.approvals.listPending(workspaceId, { limit: 100 });
      const queue = businessOS.approvals.getWorkQueue(workspaceId);
      if (json) {
        console.log(JSON.stringify({ pending, workQueue: queue }, null, 2));
        return;
      }
      console.log(`${xrBold("Work Queue")} workspace=${workspaceId}`);
      console.log(xrDim("─".repeat(60)));
      console.log(`  Pending approvals: ${queue.pendingApprovals} | Pending reviews: ${queue.pendingReviews} | Critical: ${xrRed(String(queue.criticalCount))}`);
      console.log('');
      const grouped = queue.grouped;
      for (const [key, reqs] of Object.entries(grouped)) {
        console.log(`  ${xrBold(key)} (${reqs.length})`);
        for (const r of reqs as any[]) {
          console.log(`    - ${r.approvalId} ${r.kind} ${r.severity} ${r.title.slice(0, 80)}`);
          console.log(`      Requested by ${r.requestedBy.kind}:${r.requestedBy.id} expires ${r.expiresAt} evidence=${r.evidence.length} artifacts=${r.artifacts.length}`);
          if (r.contextShown.uncertainty) {
            console.log(`      Uncertainty: confidence=${r.contextShown.uncertainty.confidence} reasons=${r.contextShown.uncertainty.reasons?.join(',')}`);
          }
        }
      }
      if (pending.length === 0) {
        console.log(xrDim("  No pending approvals — all clear."));
      }
      console.log(`\n  Use ${xrBold("xr business approvals decide <id> --outcome approved")} to approve`);
      return;
    }

    if (sub === "approve" || sub === "decide") {
      const approvalId = rawArgs[1];
      const outcome = rawArgs[2] ?? 'approved';
      if (!approvalId) {
        console.log(`Usage: xr business approvals decide <approvalId> [approved|denied|rejected|changes_requested] [--comment \"...\"]`);
        return;
      }
      const commentIdx = rawArgs.indexOf('--comment');
      const comment = commentIdx !== -1 ? rawArgs[commentIdx + 1] : undefined;
      try {
        const result = businessOS.approvals.decide(approvalId, { decidedBy: 'cli-user', outcome: outcome as any, comment });
        if (json) console.log(JSON.stringify(result, null, 2));
        else ok(`Approval ${approvalId} decided: ${result.status}`);
      } catch (e) {
        warn((e as Error).message);
      }
      return;
    }

    // ── workers ───────────────────────────────────────────────────────
    if (sub === "workers" || sub === "worker") {
      const action = rawArgs[1] ?? "list";
      if (action === "list") {
        const workers = businessOS.workerGovernance.listByWorkspace(workspaceId);
        const inspections = workers.map((w: any) => businessOS.workerGovernance.inspect(w.workerId)).filter(Boolean);
        if (json) {
          console.log(JSON.stringify({ workers, inspections }, null, 2));
        } else {
          console.log(`${xrBold("AI Workers")} workspace=${workspaceId} total=${workers.length}`);
          console.log(xrDim("─".repeat(60)));
          for (const insp of inspections as any[]) {
            const p = insp.profile;
            const b = insp.budgetStatus;
            console.log(`  ${p.role} ${p.identity.name} ${p.status.enabled ? xrGreen('enabled') : xrRed('disabled')} budgetUsed $${p.budget.usedUsdToday.toFixed(2)}/${p.budget.maxUsdPerDay} remaining $${b.remainingUsd.toFixed(2)} (${b.pctUsed.toFixed(0)}%)`);
            console.log(`    Allowed workflows: ${p.allowedWorkflows.join(', ')}`);
            console.log(`    Data access: ${p.dataAccess.resources.join(', ')} crossWs=${p.dataAccess.crossWorkspace}`);
            console.log(`    Risk: ${p.risk.maxTier} placements=${p.risk.allowedPlacements.join(',')} approvalReq=${p.approval.requiresApprovalActions.slice(0, 3).join(',')}`);
            console.log(`    Effective authority: ${Object.entries(insp.effectiveAuthority).map(([k, v]) => `${k}:${(v as any).join(',')}`).join(' | ')}`);
            console.log('');
          }
        }
        return;
      }
      if (action === "inspect" || action === "show") {
        const workerId = rawArgs[2];
        if (!workerId) {
          console.log(`Usage: xr business workers inspect <workerId>`);
          return;
        }
        const insp = businessOS.workerGovernance.inspect(workerId);
        if (!insp) {
          console.log(`Worker not found or no governance profile: ${workerId}`);
          return;
        }
        if (json) console.log(JSON.stringify(insp, null, 2));
        else console.log(JSON.stringify(insp, null, 2).slice(0, 5000));
        return;
      }
      if (action === "enable" || action === "disable") {
        const workerId = rawArgs[2];
        if (!workerId) {
          console.log(`Usage: xr business workers ${action} <workerId> [--reason "..."]`);
          return;
        }
        const reasonIdx = rawArgs.indexOf('--reason');
        const reason = reasonIdx !== -1 ? rawArgs[reasonIdx + 1] : undefined;
        const enabled = action === "enable";
        try {
          const result = businessOS.workerGovernance.setEnabled(workerId, enabled, { actorId: 'cli-user', reason });
          if (json) console.log(JSON.stringify(result, null, 2));
          else ok(`Worker ${workerId} ${enabled ? 'enabled' : 'disabled'}${reason ? ` reason: ${reason}` : ''}`);
        } catch (e) {
          warn((e as Error).message);
        }
        return;
      }
    }

    // ── artifacts ─────────────────────────────────────────────────────
    if (sub === "artifacts" || sub === "artifact") {
      const artifacts = businessOS.artifacts.listByWorkspace(workspaceId, { limit: 50 });
      if (json) {
        console.log(JSON.stringify({ artifacts, count: artifacts.length }, null, 2));
      } else {
        console.log(`${xrBold("Artifacts")} workspace=${workspaceId} count=${artifacts.length}`);
        console.log(xrDim("─".repeat(60)));
        for (const art of artifacts) {
          console.log(`  ${art.artifactId} ${art.contract.kind}/${art.contract.name} hash=${art.contentHash.slice(0, 16)} sensitivity=${art.sensitivity}`);
          console.log(`    Location: ${art.location} Workflow: ${art.workflowRunId ?? '-'} Records: ${art.linkedRecords.length}`);
          console.log(`    Provenance: actor=${art.provenance.actor.kind}:${art.provenance.actor.id} sources=${art.provenance.sources.length}`);
        }
      }
      return;
    }

    // ── mutations ─────────────────────────────────────────────────────
    if (sub === "mutations" || sub === "mutation" || sub === "records") {
      const mutations = businessOS.recordMutations.listByWorkspace(workspaceId, { limit: 50 });
      const chain = businessOS.recordMutations.verifyChain(workspaceId);
      if (json) {
        console.log(JSON.stringify({ mutations, chainValid: chain.valid }, null, 2));
      } else {
        console.log(`${xrBold("Record Mutations")} workspace=${workspaceId} count=${mutations.length} chainValid=${chain.valid}`);
        console.log(xrDim("─".repeat(60)));
        for (const m of mutations.slice(0, 20)) {
          console.log(`  ${m.mutationId} ${m.module}/${m.entity}/${m.entityId} ${m.operation} actor=${m.actor.kind}:${m.actor.id} v${m.version} hash=${m.contentHash.slice(0, 12)}`);
          console.log(`    Workflow: ${m.workflowRef?.definitionId ?? '-'} run=${m.workflowRef?.runId ?? '-'} evidence=${m.evidence.length} ctx=${m.contextPackageIds.length} reversible=${m.reversible}`);
          if (m.policyDecision) console.log(`    Policy: ${m.policyDecision.decision} ${m.policyDecision.reason}`);
          if (m.approvalRef) console.log(`    Approval: ${m.approvalRef.outcome} by ${m.approvalRef.decidedBy}`);
        }
      }
      return;
    }

    // ── privacy ───────────────────────────────────────────────────────
    if (sub === "privacy") {
      const policy = businessOS.privacy.getPolicy(workspaceId);
      if (json) {
        console.log(JSON.stringify({ policy }, null, 2));
      } else {
        console.log(`${xrBold("Privacy Policy")} workspace=${workspaceId}`);
        if (!policy) {
          console.log(xrDim("  No policy yet — default private will be created on journey start"));
        } else {
          console.log(`  Mode: ${policy.mode} Rules: ${policy.rules.length}`);
          for (const rule of policy.rules) {
            console.log(`    - ${rule.resource} sensitivity=${rule.sensitivity} transfer=${rule.transferPolicy} approval=${rule.requiresApproval} mask=${(rule as any).maskFields?.join(',') ?? '-'}`);
          }
        }
      }
      return;
    }

    // ── audit / verify ────────────────────────────────────────────────
    if (sub === "audit" || sub === "verify") {
      const action = rawArgs[1] ?? "verify";
      if (action === "verify" || action === "check") {
        const verification = businessOS.operatingLayer.verifyIntegrity(workspaceId, orgId);
        const auditLog = businessOS.audit.getLog(orgId, { limit: 5 });
        if (json) {
          console.log(JSON.stringify({ verification, recentAudit: auditLog }, null, 2));
        } else {
          console.log(`${xrBold("Integrity Verification")} org=${orgId} ws=${workspaceId}`);
          console.log(`  Audit valid: ${verification.auditValid ? xrGreen('yes') : xrRed('no')}`);
          console.log(`  Mutations valid: ${verification.mutationsValid ? xrGreen('yes') : xrRed('no')}`);
          console.log(`  Outcomes: ${verification.outcomes}`);
          console.log(`  Recent audit entries: ${auditLog.length}`);
          for (const entry of auditLog) {
            console.log(`    - ${entry.timestamp} ${entry.action} ${entry.resource}/${entry.resourceId} actor=${entry.actorId}`);
          }
        }
        return;
      }
      // audit log
      const log = businessOS.audit.getLog(orgId, { limit: 20 });
      if (json) console.log(JSON.stringify({ log }, null, 2));
      else {
        console.log(`${xrBold("Audit Log")} org=${orgId} entries=${log.length}`);
        for (const e of log) {
          console.log(`  ${e.timestamp} ${e.action} ${e.resource}/${e.resourceId} ${e.actorId} hash=${e.hash.slice(0, 12)}`);
        }
      }
      return;
    }

    if (sub === "help" || sub === "--help" || sub === "-h") {
      console.log(`Usage: xr business [subcommand] [options]`);
      console.log(`Subcommands:`);
      console.log(`  status                         Show health + operating layer status`);
      console.log(`  init                           Initialize business tables`);
      console.log(`  journeys list                  List outcome-oriented journeys`);
      console.log(`  journeys start <id>            Start a journey (outcome-oriented)`);
      console.log(`  journeys show <id>             Show journey definition`);
      console.log(`  outcomes list                  List verified outcomes`);
      console.log(`  outcomes show <id>             Show outcome detail (records, artifacts, cost/time, evidence)`);
      console.log(`  approvals / work-queue         Show work queues, approvals, reviews, escalations`);
      console.log(`  workers list                   List AI workers with narrow authority, budget, status`);
      console.log(`  workers inspect <id>           Inspect effective authority, budget, risk`);
      console.log(`  workers enable/disable <id>    Enable/disable worker (revokes authority)`);
      console.log(`  artifacts                      List artifacts with provenance`);
      console.log(`  mutations                      List record mutations with audit linkage`);
      console.log(`  privacy                        Show privacy/local operation policy`);
      console.log(`  audit verify                   Verify audit chain + mutation integrity`);
      console.log(`Options:`);
      console.log(`  --workspace <id> -w <id>        Workspace ID (default: default)`);
      console.log(`  --org <id>                      Org ID (default: default-org)`);
      console.log(`  --json -j                       JSON output (non-TTY, machine readable)`);
      console.log(`  --input '<json>'                Input for journey start`);
      console.log(`\nExamples:`);
      console.log(`  xr business journeys list --json`);
      console.log(`  xr business journeys start personal-knowledge-capture --workspace ws1 --input '{\"notes\":\"Meeting notes\"}'`);
      console.log(`  xr business work-queue --workspace ws1`);
      console.log(`  xr business workers list --json`);
      return;
    }

    // Fallback: show status
    warn(`Unknown business subcommand: ${sub}`);
    console.log(`Run ${xrBold("xr business help")} for usage`);
  }
}

export class BizAliasCommand implements Command {
  name = "biz";
  description = "Alias for xr business — XR 5.3 Operating Layer";
  usage = "xr biz [status|init|journeys|outcomes|approvals|workers|artifacts|mutations|privacy|work-queue|audit]";

  async execute(ctx: CommandContext): Promise<void> {
    const cmd = new BusinessCommand();
    await cmd.execute({ ...ctx, args: ctx.args });
  }
}

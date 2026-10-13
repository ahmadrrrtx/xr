/**
 * XR Cloud — policy routes.
 *
 * Policy is admin-authored and read on the hot path of every managed-model call.
 * Two things follow from that:
 *
 *   - **Writes are audited with old and new values.** A cap change is the kind of
 *     event an organization gets asked about later ("why did spend jump on the
 *     14th?"), so the answer must be in the log, not reconstructed.
 *   - **Reads are served from the row, not a cache**, at least in v1. The daemon
 *     caches its own copy and re-fetches on change, so correctness does not depend
 *     on this endpoint being fast — and a stale cap is worse than a slow one.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppDeps } from "../deps.ts";
import { policies, type PolicyRow } from "../db/schema.ts";
import { conflict, forbidden } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { requireOrgMember, requireRole, requireUser } from "../middleware/auth.ts";
import { parseBody } from "../middleware/validate.ts";
import { crossCheckPolicy, policySchema } from "../schemas.ts";
import { DEFAULT_POLICY, policyView } from "../services/policy.ts";

export function policyRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  async function loadRow(orgId: string): Promise<PolicyRow | undefined> {
    const rows = await deps.db.select().from(policies).where(eq(policies.orgId, orgId)).limit(1);
    return rows[0];
  }

  app.get("/teams/:id/policies", requireUser(deps), requireOrgMember(deps, "id"), async (c) => {
    const member = c.get("currentMember");
    const row = await loadRow(member.orgId);
    const view = policyView(row);
    return c.json({
      policies: view,
      // Stated so a client never has to infer whether it is looking at stored
      // values or defaults.
      source: row ? "stored" : "defaults",
      viewerRole: member.role,
    });
  });

  app.put(
    "/teams/:id/policies",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const body = await parseBody(c, policySchema);

      const problem = crossCheckPolicy(body);
      if (problem) throw conflict("That policy combination cannot do what it looks like it does.", problem);

      // Policy applies to everyone including admins — except that an admin cannot
      // restrict the providers an OWNER may use, because an owner may need to
      // reach a provider to fix an outage. Enforced by refusing the write rather
      // than by a silent exception at read time.
      if (member.role === "admin" && body.disableByok === true) {
        throw forbidden(
          "Only an owner can disable bring-your-own-key for the whole team. " +
            "BYOK is what keeps XR working for people whose organization will not pay for managed models.",
        );
      }

      const existing = await loadRow(member.orgId);
      const before = policyView(existing);
      const now = deps.clock();

      const values = {
        includedQuotaMicroUsd: body.includedQuotaMicroUsd ?? before.includedQuotaMicroUsd,
        defaultDailyBudgetMicroUsd:
          body.defaultDailyBudgetMicroUsd !== undefined ? body.defaultDailyBudgetMicroUsd : before.defaultDailyBudgetMicroUsd,
        defaultMonthlyBudgetMicroUsd:
          body.defaultMonthlyBudgetMicroUsd !== undefined
            ? body.defaultMonthlyBudgetMicroUsd
            : before.defaultMonthlyBudgetMicroUsd,
        teamMonthlyBudgetMicroUsd:
          body.teamMonthlyBudgetMicroUsd !== undefined ? body.teamMonthlyBudgetMicroUsd : before.teamMonthlyBudgetMicroUsd,
        requireApprovalAboveMicroUsd:
          body.requireApprovalAboveMicroUsd !== undefined
            ? body.requireApprovalAboveMicroUsd
            : before.requireApprovalAboveMicroUsd,
        allowedProviders: body.allowedProviders ?? before.allowedProviders,
        egressRules: body.egressRules ?? before.egressRules,
        dataRetentionDays: body.dataRetentionDays ?? before.dataRetentionDays,
        auditRetentionDays: body.auditRetentionDays ?? before.auditRetentionDays,
        blockSensitiveMemory: body.blockSensitiveMemory ?? before.blockSensitiveMemory,
        disableByok: body.disableByok ?? before.disableByok,
        relayEnabled: body.relayEnabled ?? before.relayEnabled,
        updatedAt: now,
      };

      const saved = await deps.db.transaction(async (tx) => {
        if (existing) {
          const rows = await tx.update(policies).set(values).where(eq(policies.id, existing.id)).returning();
          return rows[0];
        }
        const rows = await tx
          .insert(policies)
          .values({ id: newId("policy"), orgId: member.orgId, ...values, createdAt: now })
          .returning();
        return rows[0];
      });

      // The audit row is written in the same request as the change. Not detached:
      // an unlogged policy change is exactly the event an auditor is looking for.
      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "policy.update",
        targetType: "policy",
        targetId: saved?.id ?? member.orgId,
        ip: c.get("meta").ip,
        userAgent: c.get("meta").userAgent,
        detail: { before: summarise(before), after: summarise(policyView(saved)) },
      });

      return c.json({ ok: true, policies: policyView(saved), source: "stored" });
    },
  );

  /** Restore the defaults. Separate from PUT so "reset" is never a typo. */
  app.delete(
    "/teams/:id/policies",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner"]),
    async (c) => {
      const member = c.get("currentMember");
      const existing = await loadRow(member.orgId);
      if (existing) {
        await deps.db.delete(policies).where(eq(policies.id, existing.id));
        await deps.audit.append({
          orgId: member.orgId,
          actorKind: "user",
          actorId: c.get("auth").userId,
          actorEmail: c.get("currentUser").email,
          action: "policy.reset",
          targetType: "policy",
          targetId: existing.id,
          ip: c.get("meta").ip,
          detail: { before: summarise(policyView(existing)), after: summarise({ ...DEFAULT_POLICY }) },
        });
      }
      return c.json({ ok: true, policies: { ...DEFAULT_POLICY }, source: "defaults" });
    },
  );

  return app;
}

/** Only the fields an auditor would ask about, with money kept in micro-USD. */
function summarise(view: ReturnType<typeof policyView>): Record<string, unknown> {
  return {
    includedQuotaMicroUsd: view.includedQuotaMicroUsd,
    defaultDailyBudgetMicroUsd: view.defaultDailyBudgetMicroUsd,
    defaultMonthlyBudgetMicroUsd: view.defaultMonthlyBudgetMicroUsd,
    teamMonthlyBudgetMicroUsd: view.teamMonthlyBudgetMicroUsd,
    requireApprovalAboveMicroUsd: view.requireApprovalAboveMicroUsd,
    allowedProviders: view.allowedProviders.map((p) => p.provider),
    egressDestinations: view.egressRules.map((r) => r.destination),
    dataRetentionDays: view.dataRetentionDays,
    auditRetentionDays: view.auditRetentionDays,
    blockSensitiveMemory: view.blockSensitiveMemory,
    disableByok: view.disableByok,
    relayEnabled: view.relayEnabled,
  };
}

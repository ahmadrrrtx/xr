/** XR 4.5 Daemon — Knowledge and Context OS routes (read + consent control). */

import { isKnowledgeEnabled, loadConfig } from "../../config/config.ts";
import { ContextRepository, adaptStoreForContext } from "../../context/repository.ts";
import { ContextInspection, residualDisclosure } from "../../context/inspection.ts";
import { ProvenanceService } from "../../context/provenance.ts";
import { CONTEXT_POLICY_VERSION, CONTEXT_TIERS, TIER_POLICIES } from "../../context/types.ts";
import { tierCeilingFor } from "../../context/policy.ts";
import { MemoryStore } from "../../context/memory/store.ts";
import { route, type DaemonRoute } from "./router.ts";
import { UndoLedger } from "../../context/undo.ts";

function repoFor(store: Parameters<typeof adaptStoreForContext>[0] & { workspaceId: string }) {
  return new ContextRepository(adaptStoreForContext(store), store.workspaceId);
}

export function contextRoutes(): DaemonRoute[] {
  return [
    route({
      id: "context.status",
      path: "/api/context",
      method: "GET",
      handle: ({ json, state }) => {
        const repo = repoFor(state.store);
        const inspector = new ContextInspection(repo, state.store.workspaceId);
        const mem = new MemoryStore(state.store);
        const { config } = loadConfig();
        return json({
          enabled: isKnowledgeEnabled(),
          policyVersion: CONTEXT_POLICY_VERSION,
          workspace: state.store.workspaceId,
          injectionMode: config.knowledge.injectionMode,
          enforceScope: config.knowledge.enforceScope,
          lexicalOnly: config.knowledge.lexicalOnly,
          health: inspector.health(),
          memory: { total: mem.count(), consent: mem.consentSummary() },
        });
      },
    }),

    route({
      id: "context.items",
      path: "/api/context/items",
      method: "GET",
      handle: ({ json, url, state }) => {
        const repo = repoFor(state.store);
        const inspector = new ContextInspection(repo, state.store.workspaceId);
        const type = url.searchParams.get("type") ?? undefined;
        const scope = url.searchParams.get("scope") ?? undefined;
        const all = url.searchParams.get("all") === "1";
        const items = inspector.list({
          type: type as never,
          projectScope: scope,
          includeRevoked: all,
          limit: 200,
        });
        return json({ count: items.length, items });
      },
    }),

    route({
      id: "context.policy",
      path: "/api/context/policy",
      method: "GET",
      handle: ({ json }) =>
        json({
          policyVersion: CONTEXT_POLICY_VERSION,
          // The tier table is the machine-readable contract the UI renders.
          tiers: CONTEXT_TIERS.map((t) => TIER_POLICIES[t]),
          actorCeilings: {
            user: tierCeilingFor("user"),
            agent: tierCeilingFor("agent"),
            plugin: tierCeilingFor("plugin"),
            mcp: tierCeilingFor("mcp"),
            model: tierCeilingFor("model"),
          },
          rule: "Memory is context, not authority. Only the 'instructions' tier may direct behavior.",
        }),
    }),

    route({
      id: "context.pending",
      path: "/api/context/pending",
      method: "GET",
      handle: ({ json, state }) => {
        const mem = new MemoryStore(state.store);
        const { proposed, quarantined } = mem.pending();
        return json({
          proposed: proposed.map(slimEntry),
          quarantined: quarantined.map(slimEntry),
          legacyUnknown: mem.legacyUnknown().length,
        });
      },
    }),

    route({
      id: "context.export",
      path: "/api/context/export",
      method: "GET",
      handle: ({ json, state }) => {
        const repo = repoFor(state.store);
        const inspector = new ContextInspection(repo, state.store.workspaceId);
        const mem = new MemoryStore(state.store);
        return json({ ...inspector.export(), memory: mem.export() });
      },
    }),

    route({
      id: "context.inspect",
      prefix: "/api/context/item/",
      method: "GET",
      handle: ({ json, path, state }) => {
        const id = decodeURIComponent(path.slice("/api/context/item/".length));
        const repo = repoFor(state.store);
        const inspector = new ContextInspection(repo, state.store.workspaceId);
        const view = inspector.inspect(id);
        if (view) {
          const prov = new ProvenanceService(repo);
          return json({ source: "context", item: view, citation: prov.citation(id) });
        }
        const mem = new MemoryStore(state.store);
        const entry = mem.get(id);
        if (!entry) return json({ error: "not found" }, 404);
        return json({ source: "user_memory", entry });
      },
    }),

    route({
      id: "context.approve",
      prefix: "/api/context/approve/",
      method: "POST",
      handle: ({ json, path, state }) => {
        const id = decodeURIComponent(path.slice("/api/context/approve/".length));
        const mem = new MemoryStore(state.store);
        const ledger = new UndoLedger(repoFor(state.store), state.store.workspaceId);
        const opId = ledger.begin("memory_approve", "user_memory", id, { actor: "dashboard" });
        const res = mem.approveConsent(id, "dashboard");
        if (res.ok) ledger.finalize(opId, "user_memory", id);
        state.store.audit("context.consent.approve", { id, ok: res.ok });
        return json(res, res.ok ? 200 : 404);
      },
    }),

    // Phase 8 · T4 — user control over memory includes UNDO (Art. VIII/XXI).
    // The daemon surfaces the existing UndoLedger: undo the latest mutation,
    // or an explicit ledger op id from the request body.
    route({
      id: "context.undo",
      path: "/api/context/undo",
      method: "POST",
      handle: async ({ json, req, state }) => {
        let id: string | undefined;
        try {
          const body = (await req.clone().json()) as { id?: unknown };
          if (typeof body?.id === "string" && body.id.trim() !== "") id = body.id;
        } catch {
          // Empty/absent body → undo the latest undoable mutation.
        }
        const repo = repoFor(state.store);
        const ledger = new UndoLedger(repo, state.store.workspaceId);
        const targetId = id ?? ledger.latestUndoable()?.id;
        if (!targetId) return json({ ok: false, reason: "nothing to undo" }, 404);
        const res = ledger.undo(targetId, { actor: "dashboard" });
        state.store.audit("context.undo", { id: targetId, ok: res.ok });
        return json(res, res.ok ? 200 : 404);
      },
    }),

    route({
      id: "context.revoke",
      prefix: "/api/context/revoke/",
      method: "POST",
      handle: ({ json, path, state }) => {
        const id = decodeURIComponent(path.slice("/api/context/revoke/".length));
        const mem = new MemoryStore(state.store);
        const ledger = new UndoLedger(repoFor(state.store), state.store.workspaceId);
        const opId = ledger.begin("memory_revoke", "user_memory", id, { actor: "dashboard" });
        const res = mem.revoke(id, "dashboard_revoked", "dashboard");
        if (res.ok) ledger.finalize(opId, "user_memory", id);
        state.store.audit("context.revoke", { id, ok: res.ok });
        return json(
          { ...res, residual: res.ok ? residualDisclosure() : [] },
          res.ok ? 200 : 404,
        );
      },
    }),
  ];
}

function slimEntry(e: ReturnType<MemoryStore["list"]>[number]) {
  return {
    id: e.id,
    content: e.content,
    category: e.category,
    scope: e.scope,
    source: e.source,
    consentState: e.consentState ?? "legacy_unknown",
    trustStatus: e.trustStatus ?? "unknown",
    provenanceKind: e.provenanceKind ?? "unknown",
    actorName: e.actorName ?? null,
    createdAt: e.createdAt,
  };
}

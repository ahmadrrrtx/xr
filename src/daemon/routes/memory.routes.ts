/**
 * XR Daemon — durable memory routes.
 *
 * Every write goes through IsolatedMemoryStore → MemoryStore, so write rules,
 * do-not-remember exclusions, consent state and the Shield-visible audit trail
 * apply here exactly as they do for the CLI and chat. The routes add two
 * things the engine does not enforce on its own: sensitive-content gating
 * (a warning the user must acknowledge) and exclusion checks on edits.
 */

import { isMemoryEnabled } from "../../config/config.ts";
import { IsolatedMemoryStore } from "../../context/isolated-store.ts";
import { inspectMemoryEngine } from "../../context/engine.ts";
import { buildMemoryGraph } from "../../context/memory/graph.ts";
import { applyConsolidation, planConsolidation } from "../../context/memory/consolidate.ts";
import { UiStateRepo } from "../../state/ui-state.ts";
import type { WorkspaceStore } from "../../state/workspace-store.ts";
import { scanSensitive } from "../../context/memory/sensitivity.ts";
import type { MemoryEntryWithContext } from "../../context/memory/types.ts";
import { route, type DaemonRoute } from "./router.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_IMPORT_ENTRIES = 5000;

interface CreateBody {
  content?: unknown;
  category?: unknown;
  scope?: unknown;
  tags?: unknown;
  importance?: unknown;
  expiresInDays?: unknown;
  acknowledgeSensitive?: unknown;
}

function asTags(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 20);
}

function expiresAtFrom(days: unknown, now: number): number | null | undefined {
  if (days === undefined) return undefined;
  if (days === null) return null;
  return typeof days === "number" && days > 0 ? now + days * DAY_MS : undefined;
}

/** The JSON shape the desktop renders. Content is returned in full; the flag tells the UI to warn. */
function view(e: MemoryEntryWithContext) {
  return {
    id: e.id,
    category: e.category,
    content: e.content,
    scope: e.scope,
    source: e.source,
    kind: e.kind ?? null,
    tags: e.tags,
    importance: e.importance,
    expiresAt: e.expiresAt ?? null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    lastAccessedAt: e.lastAccessedAt ?? null,
    accessCount: e.accessCount ?? 0,
    consentState: e.consentState,
    provenanceKind: e.provenanceKind ?? null,
    provenanceRef: e.provenanceRef ?? null,
    sensitive: scanSensitive(e.content).map((m) => m.kind),
  };
}

/** Settings view. Auto-memory is OFF by default and has no implementation in this version. */
function settingsView(store: WorkspaceStore) {
  const row = new UiStateRepo(store, store.workspaceId).get(["memory.show_expired"])[0];
  return { autoMemory: "off" as const, autoMemoryAvailable: false, showExpired: row?.value === true };
}

export function memoryRoutes(): DaemonRoute[] {
  return [
    route({
      id: "memory.list",
      path: "/api/memory",
      method: "GET",
      handle: ({ json, url, state }) => {
        const mem = new IsolatedMemoryStore(state.store);
        // Exclusion rules are policy, not recall: hidden unless the Memory Explorer asks for them.
        const includeExclusions = url.searchParams.get("exclusions") === "1";
        const includeExpired = url.searchParams.get("expired") === "1";
        const entries = mem.list({ includeExclusions, includeExpired }).map(view);
        return json({
          enabled: isMemoryEnabled(),
          count: mem.count(),
          stats: mem.stats(),
          health: mem.health(),
          engine: inspectMemoryEngine(state.store),
          entries,
        });
      },
    }),
    route({
      id: "memory.health",
      path: "/api/memory/health",
      method: "GET",
      handle: ({ json, state }) => {
        const mem = new IsolatedMemoryStore(state.store);
        return json({ enabled: isMemoryEnabled(), ...mem.health(), engine: inspectMemoryEngine(state.store) });
      },
    }),
    route({
      id: "memory.search",
      path: "/api/memory/search",
      method: "GET",
      handle: ({ json, url, state }) => {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (!q) return json({ results: [] });
        const mem = new IsolatedMemoryStore(state.store);
        const results = mem.search(q).map((e) => ({
          id: e.id,
          category: e.category,
          content: e.content,
          scope: e.scope,
          tags: e.tags,
          importance: e.importance,
          sensitive: scanSensitive(e.content).map((m) => m.kind),
        }));
        return json({ query: q, results });
      },
    }),
    route({
      id: "memory.create",
      path: "/api/memory",
      method: "POST",
      handle: async ({ json, req, state }) => {
        const body = ((await req.json().catch(() => null)) ?? null) as CreateBody | null;
        if (!body || typeof body.content !== "string" || !body.content.trim()) {
          return json({ ok: false, reason: "content is required" }, 400);
        }
        const content = body.content.trim();
        const sensitive = scanSensitive(content);
        if (sensitive.length > 0 && body.acknowledgeSensitive !== true) {
          return json({ ok: false, reason: "sensitive", sensitive, message: "This looks sensitive. Save only if you are sure." }, 409);
        }
        const mem = new IsolatedMemoryStore(state.store);
        const now = Date.now();
        const expiresAt = expiresAtFrom(body.expiresInDays, now);
        const res = mem.add({
          content,
          category: typeof body.category === "string" ? (body.category as MemoryEntryWithContext["category"]) : "fact",
          ...(typeof body.scope === "string" && body.scope.trim() ? { scope: body.scope.trim() } : {}),
          source: "user",
          provenance: { source: "user" },
          tags: asTags(body.tags),
          importance: typeof body.importance === "number" ? body.importance : undefined,
          ttlMs: typeof expiresAt === "number" ? expiresAt - now : null,
          actor: "user",
        });
        if (!res.ok) {
          const excluded = (res.reason ?? "").startsWith("blocked by do-not-remember");
          return json({ ok: false, reason: res.reason ?? "not saved", excluded }, excluded ? 422 : 400);
        }
        state.store.audit("memory.create", { id: res.entry?.id, category: res.entry?.category, duplicate: res.duplicate === true });
        return json({ ok: true, duplicate: res.duplicate === true, entry: res.entry ? view(res.entry) : null, conflicts: res.conflicts ?? [] }, res.duplicate ? 200 : 201);
      },
    }),
    route({
      id: "memory.update",
      prefix: "/api/memory/",
      method: "PATCH",
      handle: async ({ json, req, path, state }) => {
        const id = decodeURIComponent(path.slice("/api/memory/".length));
        const mem = new IsolatedMemoryStore(state.store);
        const current = mem.get(id);
        if (!current) return json({ ok: false, reason: "not found" }, 404);
        const body = ((await req.json().catch(() => null)) ?? null) as CreateBody | null;
        if (!body) return json({ ok: false, reason: "invalid body" }, 400);
        if (typeof body.content === "string") {
          const sensitive = scanSensitive(body.content);
          if (sensitive.length > 0 && body.acknowledgeSensitive !== true) {
            return json({ ok: false, reason: "sensitive", sensitive }, 409);
          }
          // The engine's update() does not run exclusion rules; enforce them here.
          const blocked = mem.matchesExclusion(body.content);
          if (blocked) return json({ ok: false, reason: `blocked by do-not-remember rule: "${blocked}"`, excluded: true }, 422);
        }
        const now = Date.now();
        const expiresAt = expiresAtFrom(body.expiresInDays, now);
        const res = mem.update(id, {
          ...(typeof body.content === "string" ? { content: body.content.trim() } : {}),
          ...(asTags(body.tags) ? { tags: asTags(body.tags) } : {}),
          ...(typeof body.importance === "number" ? { importance: body.importance } : {}),
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        });
        if (!res.ok) return json({ ok: false, reason: res.reason ?? "not saved" }, res.reason === "not found" ? 404 : 400);
        return json({ ok: true, entry: res.entry ? view({ ...current, ...res.entry, consentState: current.consentState }) : null });
      },
    }),
    route({
      id: "memory.export",
      path: "/api/memory/export",
      method: "GET",
      handle: ({ json, state }) => {
        const mem = new IsolatedMemoryStore(state.store);
        const bundle = mem.export();
        // Keep only what this workspace's isolated view can see (the export itself is unfiltered).
        const visible = new Set(mem.list({ includeExclusions: true, includeExpired: true }).map((e) => e.id));
        const entries = bundle.entries.filter((e) => visible.has(e.id));
        state.store.audit("memory.export", { count: entries.length });
        return json({ ...bundle, entries, count: entries.length });
      },
    }),
    route({
      id: "memory.import",
      path: "/api/memory/import",
      method: "POST",
      handle: async ({ json, req, state }) => {
        const body = ((await req.json().catch(() => null)) ?? null) as { bundle?: unknown; mode?: unknown; acknowledgeReplace?: unknown } | null;
        const bundle = body?.bundle as { format?: unknown; entries?: unknown[] } | undefined;
        if (!bundle || bundle.format !== "xr-memory" || !Array.isArray(bundle.entries)) {
          return json({ ok: false, reason: "not an xr-memory export" }, 400);
        }
        if (bundle.entries.length > MAX_IMPORT_ENTRIES) return json({ ok: false, reason: `too many entries (>${MAX_IMPORT_ENTRIES})` }, 400);
        const replace = body?.mode === "replace";
        if (replace && body?.acknowledgeReplace !== true) return json({ ok: false, reason: "replace needs acknowledgeReplace" }, 400);
        const mem = new IsolatedMemoryStore(state.store);
        // Sensitive content is never imported silently: skip it and say so.
        let skippedSensitive = 0;
        const safe = bundle.entries.filter((raw) => {
          const content = (raw as { content?: unknown })?.content;
          if (typeof content === "string" && scanSensitive(content).length > 0) {
            skippedSensitive++;
            return false;
          }
          return true;
        });
        let cleared = 0;
        if (replace) cleared = mem.clear();
        const res = mem.import({ ...bundle, entries: safe });
        state.store.audit("memory.import", { mode: replace ? "replace" : "merge", added: res.added, skipped: res.skipped, skippedSensitive, cleared });
        return json({ ok: res.errors === 0 || res.added > 0, ...res, skippedSensitive, cleared });
      },
    }),
    route({
      id: "memory.graph",
      path: "/api/memory/graph",
      method: "GET",
      handle: ({ json, state }) => {
        const mem = new IsolatedMemoryStore(state.store);
        const entries = mem.list({ includeExclusions: false, includeExpired: false });
        return json(buildMemoryGraph(entries.map((e) => ({ id: e.id, category: e.category, content: e.content, scope: e.scope, tags: e.tags, importance: e.importance }))));
      },
    }),
    route({
      id: "memory.settings.get",
      path: "/api/memory/settings",
      method: "GET",
      handle: ({ json, state }) => json(settingsView(state.store)),
    }),
    route({
      id: "memory.settings.put",
      path: "/api/memory/settings",
      method: "PUT",
      handle: async ({ json, req, state }) => {
        const body = ((await req.json().catch(() => null)) ?? null) as { showExpired?: unknown; autoMemory?: unknown } | null;
        if (!body) return json({ ok: false, reason: "invalid body" }, 400);
        // Refuse to turn auto-memory on: there is no implementation behind it in this version.
        if (body.autoMemory === true) {
          return json({ ok: false, reason: "automatic memory is not available in this version" }, 409);
        }
        if (typeof body.showExpired === "boolean") {
          new UiStateRepo(state.store, state.store.workspaceId).patch({ "memory.show_expired": body.showExpired });
          state.store.audit("memory.settings", { showExpired: body.showExpired });
        }
        return json({ ok: true, ...settingsView(state.store) });
      },
    }),
    route({
      id: "memory.consolidate",
      path: "/api/memory/consolidate",
      method: "POST",
      handle: async ({ json, req, state }) => {
        const body = ((await req.json().catch(() => null)) ?? null) as {
          apply?: unknown;
          olderThanDays?: unknown;
          maxImportance?: unknown;
          scope?: unknown;
        } | null;
        // Budget is the engine's default; the client cannot widen it.
        const opts = {
          ...(typeof body?.olderThanDays === "number" ? { olderThanDays: body.olderThanDays } : {}),
          ...(typeof body?.maxImportance === "number" ? { maxImportance: body.maxImportance } : {}),
          ...(typeof body?.scope === "string" && body.scope.trim() ? { scope: body.scope.trim() } : {}),
        };
        const mem = new IsolatedMemoryStore(state.store);
        const plan = planConsolidation(mem, opts);
        const summary = { groups: plan.groups.length, originals: plan.totalOriginals, alreadyConsolidated: plan.alreadyConsolidated };
        // Plan-only unless the caller explicitly asks to apply. Originals are superseded, never deleted.
        if (body?.apply !== true) return json({ ok: true, applied: false, plan: summary });
        const result = await applyConsolidation(state.store, mem, plan, opts);
        return json({ ok: true, applied: true, plan: summary, result });
      },
    }),
    route({
      id: "memory.scan",
      path: "/api/memory/scan-sensitive",
      method: "POST",
      handle: async ({ json, req }) => {
        const body = ((await req.json().catch(() => null)) ?? null) as { content?: unknown } | null;
        if (!body || typeof body.content !== "string") return json({ ok: false, reason: "content is required" }, 400);
        // Read-only: the text is scanned and discarded, never stored.
        return json({ ok: true, matches: scanSensitive(body.content) });
      },
    }),
    route({
      id: "memory.delete",
      prefix: "/api/memory/",
      method: "DELETE",
      handle: ({ json, path, state }) => {
        const key = decodeURIComponent(path.slice("/api/memory/".length));
        const mem = new IsolatedMemoryStore(state.store);
        if (key === "*" || key === "all") {
          const n = mem.clear();
          state.store.audit("memory.clear_all", { removed: n });
          return json({ ok: true, removed: n });
        }
        const r = mem.remove(key);
        state.store.audit("memory.delete", { id: key, ok: r.ok });
        return json({ ok: r.ok, reason: r.reason }, r.ok ? 200 : 404);
      },
    }),
  ];
}

/**
 * XR 4.5 — ContextService: the Knowledge and Context OS facade.
 *
 * Platform facade over policy + repository + retrieval + assembly + injection +
 * compression + provenance + inspection.
 *
 * It does NOT own:
 *   • provider/model selection  → Phase 5 IntelligenceService
 *   • authority/isolation       → Phase 3 TrustService
 *   • durable execution         → Phase 4 ExecutionService
 *   • workflow orchestration    → Phase 7 (not this phase)
 */

import type { ServiceRegistry } from "../core/service-registry.ts";
import { LifecycleHook } from "../core/lifecycle.ts";
import { Tokens } from "../core/tokens.ts";
import type { WorkspaceStore } from "../state/workspace-store.ts";
import { MemoryStore, projectScopeFromCwd } from "./memory/store.ts";
import {
  CONTEXT_POLICY_VERSION,
  DEFAULT_USER_ID,
  GLOBAL_PROJECT_SCOPE,
  computeFreshness,
  defaultTierForType,
  emptyLinks,
  type ActorKind,
  type ConsentState,
  type ContextGrant,
  type ContextItem,
  type ContextPackage,
  type ContextScope,
  type ContextTier,
  type ContextType,
  type InjectionPackage,
  type ProvenanceKind,
  type ProvenanceRef,
  type SensitivityLevel,
  type TrustStatus,
} from "./types.ts";
import { buildGrant, denyAllGrant, makeScope, type GrantRequest } from "./policy.ts";
import { admitContextWrite, type AdmissionDecision } from "./poison.ts";
import { ContextRepository, adaptStoreForContext } from "./repository.ts";
import { ContextRetrieval, type ExternalCandidate } from "./retrieval.ts";
import { ContextAssembler } from "./assembler.ts";
import { buildInjectionPackage, type InjectionOptions } from "./injection.ts";
import { ContextInspection } from "./inspection.ts";
import { ProvenanceService } from "./provenance.ts";
import { routeModelClass, type EmbeddingRoute } from "./embedding.ts";
import { memoryEntryToContextItem } from "./memory-adapter.ts";
import { ProgressiveLifecycle, type PromotionResult, type LifecycleOptions } from "./lifecycle.ts";
import { ConflictResolver, type OpenConflict, type ResolutionKind, type ResolutionOutcome } from "./conflicts.ts";
import { UndoLedger, type UndoOutcome } from "./undo.ts";

export interface ContextServiceOptions {
  /** Override the workspace id (defaults to the store's). */
  workspaceId?: string;
  /** Skip intelligence-plane routing (tests / offline). */
  lexicalOnly?: boolean;
}

export interface RequestContextOptions {
  /** Who is asking. */
  requester: { kind: ActorKind; id: string; role?: string };
  /** The task/goal driving the request — used for explanations. */
  intent: string;
  /** The text used for ranking (defaults to `intent`). */
  query?: string;
  /** Working directory, used to derive the project scope. */
  cwd?: string;
  projectScope?: string;
  taskId?: string;
  agentId?: string;
  /** Tiers the caller wants. Policy may only narrow this. */
  tiers?: readonly ContextTier[];
  /** Declared agent memory scope kind (from `src/agents/types.ts`). */
  memoryScopeKind?: string;
  includeUserMemory?: boolean;
  maxItems?: number;
  maxChars?: number;
  /** Durable run id for checkpoint linkage. */
  runId?: string;
  lexicalOnly?: boolean;
  /** Phase 6 · T1 — "deep" also ranks externalized originals. */
  depth?: "progressive" | "deep";
}

export interface RecordContextOptions {
  type: ContextType;
  content: string;
  title?: string;
  /** Trust the caller believes applies. Clamped by provenance. */
  trust?: TrustStatus;
  provenanceKind: ProvenanceKind;
  provenanceRef?: string;
  actorKind: ActorKind;
  actorName?: string;
  /** Consent the caller requests. Downgraded when the actor cannot self-approve. */
  consent?: ConsentState;
  cwd?: string;
  projectScope?: string;
  taskId?: string;
  agentId?: string;
  sensitivity?: SensitivityLevel;
  sourceObservedAt?: number;
  staleAfter?: number;
  expiresAt?: number;
  confidence?: "high" | "medium" | "low" | "unknown";
  links?: ContextItem["links"];
  tags?: string[];
  references?: readonly ProvenanceRef[];
}

export interface RecordResult {
  ok: boolean;
  id?: string;
  /** What policy actually recorded (may differ from what was asked). */
  decision: AdmissionDecision;
  reason: string;
}

export class ContextService implements LifecycleHook {
  private readonly repo: ContextRepository;
  private readonly provenanceSvc: ProvenanceService;
  private readonly inspector: ContextInspection;
  private readonly lifecycle: ProgressiveLifecycle;
  private readonly conflicts: ConflictResolver;
  private readonly undo: UndoLedger;
  private route: EmbeddingRoute;
  private readonly wsId: string;
  private readonly lexicalOnly: boolean;

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly store: WorkspaceStore,
    opts: ContextServiceOptions = {},
  ) {
    this.wsId = opts.workspaceId ?? store.workspaceId ?? "default";
    this.lexicalOnly = opts.lexicalOnly ?? false;
    this.repo = new ContextRepository(adaptStoreForContext(store), this.wsId);
    this.repo.migrate();
    this.provenanceSvc = new ProvenanceService(this.repo);
    this.inspector = new ContextInspection(this.repo, this.wsId);
    this.lifecycle = new ProgressiveLifecycle(this.repo, this.wsId);
    this.conflicts = new ConflictResolver(this.repo, this.wsId);
    this.undo = new UndoLedger(this.repo, this.wsId);
    this.route = { model: "lexical", locality: "local", fallback: true, reason: "not yet routed" };
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  get repository(): ContextRepository {
    return this.repo;
  }

  get provenance(): ProvenanceService {
    return this.provenanceSvc;
  }

  get inspection(): ContextInspection {
    return this.inspector;
  }

  get workspaceId(): string {
    return this.wsId;
  }

  get policyVersion(): string {
    return CONTEXT_POLICY_VERSION;
  }

  /** The embedding route currently in effect (for `xr context status`). */
  embeddingRoute(): EmbeddingRoute {
    return this.route;
  }

  /** Re-route the embedding model through the Phase 5 plane. */
  refreshRoute(opts: { localOnly?: boolean } = {}): EmbeddingRoute {
    if (this.lexicalOnly) {
      this.route = {
        model: "lexical",
        locality: "local",
        fallback: true,
        reason: "lexical-only mode",
      };
      return this.route;
    }
    this.route = routeModelClass(this.registry, "embeddings", {
      localOnly: opts.localOnly,
      summary: "context retrieval embedding",
    });
    return this.route;
  }

  // ── Grants ───────────────────────────────────────────────────────────────

  /** Build a scope from the current environment. */
  scopeFor(opts: { cwd?: string; projectScope?: string; taskId?: string; agentId?: string } = {}): ContextScope {
    return makeScope({
      workspaceId: this.wsId,
      projectScope:
        opts.projectScope ?? (opts.cwd ? projectScopeFromCwd(opts.cwd) : GLOBAL_PROJECT_SCOPE),
      userId: DEFAULT_USER_ID,
      ...(opts.taskId ? { taskId: opts.taskId } : {}),
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
    });
  }

  /** Build a grant. Memory-disabled config produces a deny-all grant. */
  grant(req: RequestContextOptions, opts: { memoryEnabled?: boolean } = {}): ContextGrant {
    const grantReq: GrantRequest = {
      requester: req.requester,
      scope: this.scopeFor(req),
      requestedTiers: req.tiers,
      maxItems: req.maxItems,
      maxChars: req.maxChars,
      auditRef: `ctx_${Date.now().toString(36)}_${req.requester.kind}`,
    };
    if (opts.memoryEnabled === false) {
      // Memory disabled → no long-term memory tier, but task/instruction context
      // still flows so the agent keeps working (§10.6 preserve behavior).
      const g = buildGrant(
        { ...grantReq, requestedTiers: (req.tiers ?? ["immediate", "recent", "task_summary", "instructions"]) },
        { memoryScopeKind: req.memoryScopeKind, includeUserMemory: false },
      );
      return { ...g, allowedTiers: g.allowedTiers.filter((t) => t !== "long_term_memory") };
    }
    return buildGrant(grantReq, {
      memoryScopeKind: req.memoryScopeKind,
      includeUserMemory: req.includeUserMemory,
    });
  }

  /** A grant that permits nothing. */
  denyGrant(req: RequestContextOptions): ContextGrant {
    return denyAllGrant({ requester: req.requester, scope: this.scopeFor(req) });
  }

  // ── Retrieval / assembly ─────────────────────────────────────────────────

  /**
   * Build a context package for a requester.
   *
   * User memory rows from `user_memory` are adapted into context items and go
   * through EXACTLY the same authorization, ranking, and explanation stages —
   * there is no privileged path for legacy memory.
   */
  async requestContext(
    req: RequestContextOptions,
    opts: { memoryEnabled?: boolean; memoryStore?: MemoryStore } = {},
  ): Promise<ContextPackage> {
    const grant = this.grant(req, opts);
    return this.assembleWithGrant(grant, req, opts);
  }

  /** Assemble using an already-built grant (used by callers that cache grants). */
  async assembleWithGrant(
    grant: ContextGrant,
    req: RequestContextOptions,
    opts: { memoryEnabled?: boolean; memoryStore?: MemoryStore } = {},
  ): Promise<ContextPackage> {
    if (this.route.reason === "not yet routed") this.refreshRoute();

    const retrieval = new ContextRetrieval(this.repo, req.lexicalOnly || this.lexicalOnly
      ? { model: "lexical", locality: "local", fallback: true, reason: "lexical-only" }
      : this.route);
    const assembler = new ContextAssembler(this.repo, retrieval);

    // Adapt durable user memory into candidates when the grant allows the tier.
    const extra: ExternalCandidate[] = [];
    if (grant.allowedTiers.includes("long_term_memory") && opts.memoryEnabled !== false) {
      try {
        const mem = opts.memoryStore ?? new MemoryStore(this.store);
        const entries = mem.list({ scope: grant.scope.projectScope });
        for (const e of entries) {
          extra.push({
            item: memoryEntryToContextItem(e, this.wsId),
            tier: "long_term_memory",
          });
        }
      } catch {
        /* memory adaptation is best-effort — never fails assembly */
      }
    }

    return assembler.assemble(
      {
        grant,
        queryIntent: req.intent,
        query: req.query ?? req.intent,
        tiers: req.tiers,
        lexicalOnly: req.lexicalOnly || this.lexicalOnly,
        depth: req.depth,
        runId: req.runId,
      },
      extra,
    );
  }

  /** Revalidate a package after a resume. */
  revalidate(pkg: ContextPackage): ContextPackage {
    const retrieval = new ContextRetrieval(this.repo, this.route);
    const assembler = new ContextAssembler(this.repo, retrieval);
    return assembler.revalidate(pkg);
  }

  /** Load a persisted package descriptor (ids + metadata) for a run. */
  packagesForRun(runId: string) {
    return this.repo.getPackagesForRun(runId);
  }

  // ── Injection ────────────────────────────────────────────────────────────

  /** Render a package into safe prompt blocks. */
  buildInjection(pkg: ContextPackage, opts: InjectionOptions = {}): InjectionPackage {
    return buildInjectionPackage(pkg, opts);
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Record a durable context item.
   *
   * Every write passes through the deterministic admission gate:
   * anti-spoofing trust clamp → self-approval block → poison scan.
   */
  record(req: RecordContextOptions, grant?: ContextGrant): RecordResult {
    const decision = admitContextWrite({
      content: req.content,
      type: req.type,
      requestedTrust: req.trust ?? "unknown",
      provenanceKind: req.provenanceKind,
      actorKind: req.actorKind,
      requestedConsent: req.consent ?? (req.type === "memory" ? "proposed" : "approved"),
    });

    if (!decision.admit) {
      return { ok: false, decision, reason: decision.reason };
    }

    // A grant, when supplied, further restricts memory writes.
    if (req.type === "memory" && grant && !grant.allowMemoryWrite && decision.consentState === "approved") {
      decision.consentState = "proposed";
      decision.adjustments.push("consent_downgraded:approved->proposed (grant does not permit memory write)");
    }

    const now = Date.now();
    const scope = this.scopeFor(req);

    let id: string;
    try {
      id = this.repo.insertItem({
        type: req.type,
        content: req.content,
        title: req.title,
        scope,
        trustStatus: decision.trustStatus,
        consentState: decision.consentState,
        consentActor: decision.consentState === "approved" ? (req.actorName ?? req.actorKind) : null,
        consentAt: decision.consentState === "approved" ? now : null,
        provenanceKind: req.provenanceKind,
        provenanceRef: req.provenanceRef ?? null,
        actorKind: req.actorKind,
        actorName: req.actorName ?? null,
        sourceObservedAt: req.sourceObservedAt ?? null,
        staleAfter: req.staleAfter ?? null,
        expiresAt: req.expiresAt ?? null,
        confidence: req.confidence ?? "unknown",
        sensitivity: req.sensitivity ?? "unknown",
        retention: req.type === "task_context" ? "task" : "durable",
        links: req.links ?? emptyLinks(),
        tags: req.tags ?? [],
        now,
      });
    } catch (e) {
      return {
        ok: false,
        decision,
        reason: `storage failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    for (const ref of req.references ?? []) this.provenanceSvc.link(id, ref);

    try {
      this.store.audit("context.record", {
        id,
        type: req.type,
        trust: decision.trustStatus,
        consent: decision.consentState,
        provenance: req.provenanceKind,
        actor: req.actorKind,
        contentLen: req.content.length,
        adjustments: decision.adjustments,
        signatures: decision.scan.signatures,
      });
    } catch {
      /* audit is best-effort */
    }

    return { ok: true, id, decision, reason: decision.reason };
  }

  /**
   * Capture untrusted external content (tool/web/MCP/plugin output).
   * Always lands as `untrusted` type with `untrusted_external` trust.
   */
  recordUntrusted(
    content: string,
    source: { kind: ProvenanceKind; ref?: string; label?: string },
    opts: { cwd?: string; taskId?: string; runId?: string; expiresInMs?: number } = {},
  ): RecordResult {
    return this.record({
      type: "untrusted",
      content,
      title: source.label,
      trust: "untrusted_external",
      provenanceKind: source.kind,
      provenanceRef: source.ref,
      actorKind: source.kind === "model_synthesis" ? "model" : "system",
      consent: "approved", // non-memory context does not need user consent
      cwd: opts.cwd,
      taskId: opts.taskId,
      links: opts.runId ? { runId: opts.runId } : undefined,
      expiresAt: opts.expiresInMs ? Date.now() + opts.expiresInMs : undefined,
      references: source.ref ? [{ kind: source.kind, ref: source.ref, label: source.label }] : [],
    });
  }

  // ── Phase 6 · T1/T4/T6: lifecycle, conflicts, undo, navigation adapters ────

  /** The evidence-lifecycle promotions surface (offline/async by design). */
  get progressiveLifecycle(): ProgressiveLifecycle {
    return this.lifecycle;
  }

  /** Promote stale verbatim task_context items to evidence-preserving summaries. */
  promoteStaleMemory(
    scope: { projectScope: string; taskId?: string },
    opts: LifecycleOptions = {},
  ): PromotionResult[] {
    return this.lifecycle.promoteStale(scope, opts);
  }

  /** Adapt one legacy `user_memory` row into a context item (read-through). */
  adaptedMemoryItem(id: string, memoryStore?: MemoryStore): ContextItem | null {
    try {
      const mem = memoryStore ?? new MemoryStore(this.store);
      const entry = mem.get(id);
      return entry ? memoryEntryToContextItem(entry, this.wsId) : null;
    } catch {
      return null; // legacy adapter is best-effort; absence is honest, not an error
    }
  }

  /** Live conflicts with their resolution status (user-visible). */
  openConflicts(projectScope?: string): OpenConflict[] {
    const candidates = this.repo.scopeCandidates(this.wsId, { projectScope, limit: 500 });
    return this.conflicts.openConflicts(candidates);
  }

  /**
   * Resolve a contradiction between two items (user decision, undoable).
   * The loser's precedence falls; its content is preserved.
   */
  resolveConflict(
    idA: string,
    idB: string,
    kind: ResolutionKind,
    opts: { reason: string; actor?: string; now?: number },
  ): ResolutionOutcome {
    const a = this.repo.getItem(idA);
    const b = this.repo.getItem(idB);
    if (!a || !b) return { ok: false, reason: !a ? `${idA} not found` : `${idB} not found` };
    const out = this.conflicts.resolve(a, b, kind, {
      decidedBy: opts.actor ?? "user",
      reason: opts.reason,
      now: opts.now,
      recordUndo: (loser) => {
        const opId = this.undo.begin("resolve", "context_items", loser.id, {
          actor: opts.actor ?? "user",
          reason: opts.reason,
          now: opts.now,
        });
        // finalize happens after supersede — scheduled via callback:
        this.deferredFinalizes.push(() => this.undo.finalize(opId, "context_items", loser.id));
        return opId;
      },
    });
    this.flushFinalizes();
    return out;
  }

  /** Selective forgetting: hard-expire an item (undoable). */
  forgetItem(
    id: string,
    opts: { reason: string; actor?: string; now?: number },
  ): { ok: boolean; opId?: string; reason?: string } {
    const item = this.repo.getItem(id);
    if (!item) return { ok: false, reason: "not found" };
    const out = this.conflicts.forget(item, {
      actor: opts.actor,
      reason: opts.reason,
      now: opts.now,
      recordUndo: (i, afterExpiry) => {
        const opId = this.undo.begin("forget", "context_items", i.id, {
          actor: opts.actor ?? "user",
          reason: opts.reason,
          now: opts.now,
        });
        this.deferredFinalizes.push(() => this.undo.finalize(opId, "context_items", i.id));
        return opId;
      },
    });
    this.flushFinalizes();
    return { ok: out.ok, ...(out.opId ? { opId: out.opId } : {}), ...(out.reason ? { reason: out.reason } : {}) };
  }

  /** Correct an item with undo capture (content-correction lineage preserved). */
  correctItem(id: string, newContent: string, actor = "user"): { ok: boolean; newId?: string; reason: string } {
    const opId = this.undo.begin("correct", "context_items", id, { actor, reason: `correct ${id}` });
    const res = this.inspector.correct(id, newContent, { actor });
    this.undo.finalize(opId, "context_items", id);
    return res;
  }

  /** Approve consent with undo capture. */
  approveItem(id: string, actor = "user"): { ok: boolean; reason: string } {
    const opId = this.undo.begin("approve", "context_items", id, { actor, reason: `approve ${id}` });
    const res = this.inspector.approve(id, actor);
    this.undo.finalize(opId, "context_items", id);
    return res;
  }

  /** Revoke consent with undo capture. */
  revokeItem(id: string, reason = "user_revoked", actor = "user"): { ok: boolean; reason: string } {
    const opId = this.undo.begin("revoke", "context_items", id, { actor, reason });
    const res = this.inspector.revoke(id, reason, actor);
    this.undo.finalize(opId, "context_items", id);
    return { ok: res.ok, reason: res.reason };
  }

  /** Delete an item with undo capture (before-image keeps it recoverable). */
  deleteItem(id: string, actor = "user"): { ok: boolean; reason: string } {
    const opId = this.undo.begin("delete", "context_items", id, { actor, reason: `delete ${id}` });
    const res = this.inspector.delete(id, actor);
    this.undo.finalize(opId, "context_items", id);
    return { ok: res.ok, reason: res.reason };
  }

  /** Undo a recorded op (or the latest one). */
  undoOp(opId?: string, actor = "user"): UndoOutcome {
    const id = opId ?? this.undo.latestUndoable()?.id;
    if (!id) return { ok: false, reason: "nothing to undo" };
    const out = this.undo.undo(id, { actor });
    this.flushFinalizes();
    return out;
  }

  /** Ops history (user-visible, content-free headers). */
  opsHistory(limit = 25): ReturnType<UndoLedger["history"]> {
    return this.undo.history({ includeUndone: true, limit });
  }

  /** Schedule finalize callbacks run just after resolve/forget transactions. */
  private deferredFinalizes: Array<() => void> = [];
  private flushFinalizes(): void {
    const q = this.deferredFinalizes.splice(0, this.deferredFinalizes.length);
    for (const f of q) f();
  }

  // ── Maintenance ──────────────────────────────────────────────────────────

  /** Prune expired items and old package rows. */
  prune(now: number = Date.now()): { items: number; packages: number } {
    let items = 0;
    let packages = 0;
    try {
      items = this.repo.pruneExpired(this.wsId, now);
    } catch {
      /* best-effort */
    }
    try {
      packages = this.repo.prunePackages(now);
    } catch {
      /* best-effort */
    }
    return { items, packages };
  }

  /** Invalidate every cached vector (e.g. after an embedding model change). */
  invalidateIndex(): number {
    return this.repo.invalidateIndex(this.wsId);
  }

  health() {
    return {
      ...this.inspector.health(),
      policyVersion: CONTEXT_POLICY_VERSION,
      embedding: this.route,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async onInit(): Promise<void> {
    try {
      this.repo.migrate();
    } catch {
      /* never block startup */
    }
  }

  async onStart(): Promise<void> {
    // Route lazily so a missing intelligence plane cannot block startup.
    try {
      this.refreshRoute();
    } catch {
      /* fallback route already set */
    }
  }

  async onStop(): Promise<void> {
    try {
      this.repo.prunePackages();
    } catch {
      /* best-effort */
    }
  }
}

export { defaultTierForType, computeFreshness };

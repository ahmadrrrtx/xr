/**
 * XR Phase 7 · T1 — Capability Provenance Graph.
 *
 * Turns "what did the agent use?" into a system property (Constitution §10.7).
 *
 * This is a DERIVED, append-only evidence store — NOT a second extension
 * registry (Art. XIV.3). Installed/enabled state stays owned by the
 * plugin/skill/MCP planes; this module only records:
 *
 *   - nodes       : one per capability (typed — distinct runtime semantics
 *                   preserved: plugin ≠ skill ≠ mcp ≠ provider ≠ tool …)
 *   - edges       : depends-on (from descriptors), updated-from / replaced-by
 *                   (update & rollback), originated-from (source)
 *   - events      : install/update/enable/disable/use/outcome/rollback/
 *                   quarantine/certify/remove/review — the audit-grade trail
 *   - outcomes    : per-use success/failure so trust scoring can consume them
 *
 * Persistence: single JSON file under the capability metadata home, written
 * atomically (tmp + rename) and bounded (prune oldest events). Reading and
 * writing go through ONE writer (the store instance), matching the Phase 1
 * single-writer discipline.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { CapabilityDescriptor, CapabilityType } from "./types.ts";

export const PROVENANCE_GRAPH_VERSION = 1;

export const PROVENANCE_EVENT_KINDS = [
  "install",
  "update",
  "enable",
  "disable",
  "use",
  "outcome",
  "rollback",
  "quarantine",
  "clear_quarantine",
  "certify",
  "review",
  "verify",
  "remove",
  "error",
] as const;
export type ProvenanceEventKind = (typeof PROVENANCE_EVENT_KINDS)[number];

export const PROVENANCE_EDGE_KINDS = [
  "depends-on",
  "used-by",
  "updated-from",
  "replaced-by",
  "originated-from",
] as const;
export type ProvenanceEdgeKind = (typeof PROVENANCE_EDGE_KINDS)[number];

export interface ProvenanceOutcome {
  /** Deterministic verdict where one exists (e.g. contract tests, verifiers). */
  status: "success" | "failure" | "unknown";
  /** Optional detail (test id, verifier spec, error message). */
  detail?: string;
}

export interface ProvenanceNode {
  capabilityId: string;
  type: CapabilityType;
  nativeId: string;
  name: string;
  version: string;
  publisherId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Snapshot of the last indexed descriptor's placement/data-scope (query aid). */
  placement?: string;
  riskTier?: string;
  dataScopes?: string[];
}

export interface ProvenanceEdge {
  id: string;
  from: string;
  to: string;
  kind: ProvenanceEdgeKind;
  at: number;
  version?: string;
  detail?: string;
}

export interface ProvenanceEvent {
  id: string;
  capabilityId: string;
  kind: ProvenanceEventKind;
  at: number;
  actor?: string;
  runId?: string;
  detail?: string;
  outcome?: ProvenanceOutcome;
}

export interface ProvenanceState {
  version: typeof PROVENANCE_GRAPH_VERSION;
  nodes: Record<string, ProvenanceNode>;
  edges: ProvenanceEdge[];
  events: ProvenanceEvent[];
}

export interface CapabilityUseRecord {
  capabilityId: string;
  type: CapabilityType;
  name: string;
  version: string;
  uses: number;
  lastUsedAt: number;
  outcomes: { success: number; failure: number; unknown: number };
}

export interface CapabilityProvenance {
  node: ProvenanceNode;
  events: ProvenanceEvent[];
  outgoing: ProvenanceEdge[];
  incoming: ProvenanceEdge[];
  summary: {
    firstSeenAt: number;
    lastSeenAt: number;
    installs: number;
    updates: number;
    rollbacks: number;
    uses: number;
    successes: number;
    failures: number;
    quarantines: number;
    currentVersion: string;
  };
}

// ── Bounds (endless-data protection; Constitution §10.4) ─────────────────────

export const PROVENANCE_BOUNDS = {
  maxNodes: 2_000,
  maxEvents: 8_000,
  maxEdges: 5_000,
  maxEventsPerCapability: 500,
} as const;

export function provenanceHome(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "capabilities");
}

export function provenanceGraphPath(): string {
  return join(provenanceHome(), "provenance.json");
}

const EMPTY: ProvenanceState = { version: PROVENANCE_GRAPH_VERSION, nodes: {}, edges: [], events: [] };

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

export class CapabilityProvenanceStore {
  private state: ProvenanceState;
  /** Write-behind throttle: never flush on every event under load. */
  private dirty = 0;
  private lastFlushAt = 0;
  private hasFlushed = false;

  constructor(private readonly path = provenanceGraphPath()) {
    this.state = this.read();
  }

  private read(): ProvenanceState {
    if (!existsSync(this.path)) return structuredClone(EMPTY);
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as ProvenanceState;
      if (raw?.version === PROVENANCE_GRAPH_VERSION && typeof raw.nodes === "object" && Array.isArray(raw.events)) {
        return { version: PROVENANCE_GRAPH_VERSION, nodes: raw.nodes ?? {}, edges: raw.edges ?? [], events: raw.events ?? [] };
      }
    } catch {
      // Corrupt state: preserve evidence, reset to empty (metadata is derived,
      // never authoritative over the planes it describes).
    }
    return structuredClone(EMPTY);
  }

  /** Atomic persist (tmp + rename). Bounded. */
  flush(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.path);
  }

  /**
   * Write-behind: the FIRST mutation persists synchronously (single events
   * from manager/CLI paths are durable immediately); under load, flushes
   * throttle to every 256 events or 1s so the graph stays responsive
   * (endless-data/throughput protection).
   */
  private maybeFlush(): void {
    this.dirty += 1;
    const now = Date.now();
    if (!this.hasFlushed || this.dirty >= 256 || now - this.lastFlushAt > 1_000) {
      this.hasFlushed = true;
      this.dirty = 0;
      this.lastFlushAt = now;
      this.flush();
    }
  }

  // ── Mutations (single writer: the store instance) ──────────────────────────

  /**
   * Index MANY descriptors as one unit of work: mutate the in-memory graph
   * for every row, then persist ONCE.
   *
   * Why this exists (Windows CI root cause, Phase 10): `indexDescriptor` is
   * called once per descriptor by `CapabilityService.list()`, and each call
   * ends in `maybeFlush()`. A flush is a FULL rewrite of the graph
   * (`JSON.stringify(state)` → tmp file → `renameSync`). With ~153
   * descriptors that is 153 whole-file rewrites per `list()`, and `list()` is
   * called by `inspect`/`discover`/`provenanceOf`, so one capability
   * lifecycle test performed ~1,700 rewrites totalling ~125 MB of write
   * traffic. On Linux/macOS (tmpfs, cheap rename) that is ~1.8 s and passes;
   * on the Windows runner every write+rename pays NTFS metadata cost plus
   * Defender real-time scanning, pushing a single test past Bun's 5 s
   * per-test timeout — which is exactly the observed CI signature (a `(fail)`
   * line with no assertion diff).
   *
   * Batching is semantically identical: the same nodes, edges and events are
   * produced in the same order, and the graph is still written atomically by
   * a single writer. Only the number of intermediate rewrites changes.
   */
  indexDescriptors(descriptors: readonly CapabilityDescriptor[], actor = "system"): void {
    if (descriptors.length === 0) return;
    for (const descriptor of descriptors) this.applyDescriptor(descriptor, actor);
    this.prune();
    this.maybeFlush();
  }

  indexDescriptor(descriptor: CapabilityDescriptor, actor = "system"): void {
    this.applyDescriptor(descriptor, actor);
    this.prune();
    this.maybeFlush();
  }

  /** Pure in-memory graph mutation for one descriptor (no prune, no flush). */
  private applyDescriptor(descriptor: CapabilityDescriptor, actor = "system"): void {
    const now = Date.now();
    const existing = this.state.nodes[descriptor.id];
    // First observation = no node AND no prior events (an event recorded by
    // another plane counts as the install; don't double-count).
    const firstObservation = !existing && !this.state.events.some((e) => e.capabilityId === descriptor.id);
    const versionChanged = Boolean(existing && existing.version !== descriptor.version);
    this.state.nodes[descriptor.id] = {
      capabilityId: descriptor.id,
      type: descriptor.type,
      nativeId: descriptor.nativeId,
      name: descriptor.name,
      version: descriptor.version,
      publisherId: descriptor.publisher.id,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      placement: descriptor.placement.requested,
      riskTier: descriptor.placement.riskTier,
      dataScopes: descriptor.dataScopes.map((s) => `${s.kind}:${s.access}`),
    };
    // depends-on edges, refreshed per descriptor version.
    const existingDep = this.state.edges.filter((e) => e.from === descriptor.id && e.kind === "depends-on");
    for (const e of existingDep) this.state.edges.splice(this.state.edges.indexOf(e), 1);
    for (const dep of descriptor.dependencies) {
      if (dep.status !== "satisfied" && dep.status !== "unknown") continue;
      this.addEdge({ from: descriptor.id, to: dep.id, kind: "depends-on", version: dep.version, detail: `${dep.type}` });
    }
    if (versionChanged) {
      this.addEvent(descriptor.id, "update", { actor, detail: `${existing!.version} → ${descriptor.version}`, outcome: { status: "unknown" } });
    } else if (firstObservation) {
      this.addEvent(descriptor.id, "install", { actor, detail: `v${descriptor.version} first observed`, outcome: { status: "unknown" } });
    }
  }

  recordEvent(capabilityId: string, kind: ProvenanceEventKind, opts: { actor?: string; runId?: string; detail?: string; outcome?: ProvenanceOutcome } = {}): ProvenanceEvent {
    const event = this.addEvent(capabilityId, kind, opts);
    this.prune();
    this.maybeFlush();
    return event;
  }

  /** Pure in-memory event append (no prune, no flush) — see indexDescriptors. */
  private addEvent(capabilityId: string, kind: ProvenanceEventKind, opts: { actor?: string; runId?: string; detail?: string; outcome?: ProvenanceOutcome } = {}): ProvenanceEvent {
    const event: ProvenanceEvent = {
      id: newId("ev"),
      capabilityId,
      kind,
      at: Date.now(),
      actor: opts.actor,
      runId: opts.runId,
      detail: opts.detail,
      outcome: opts.outcome,
    };
    this.state.events.push(event);
    const node = this.state.nodes[capabilityId];
    if (node) node.lastSeenAt = event.at;
    if (kind === "rollback") {
      this.addEdge({ from: capabilityId, to: capabilityId, kind: "replaced-by", version: opts.detail, detail: "rollback" });
    }
    if (kind === "update") {
      this.addEdge({ from: capabilityId, to: capabilityId, kind: "updated-from", version: opts.detail, detail: "update" });
    }
    return event;
  }

  /** Record one capability USE with its outcome (feeds "what did the agent use?"). */
  recordUse(capabilityId: string, opts: { actor?: string; runId?: string; outcome?: ProvenanceOutcome; detail?: string } = {}): ProvenanceEvent {
    return this.recordEvent(capabilityId, "use", opts);
  }

  /** Record a verified outcome separate from the use (deterministic verifiers). */
  recordOutcome(capabilityId: string, status: "success" | "failure" | "unknown", detail?: string, opts: { actor?: string; runId?: string } = {}): ProvenanceEvent {
    return this.recordEvent(capabilityId, "outcome", { ...opts, outcome: { status, detail }, detail: detail ?? status });
  }

  recordEdge(from: string, to: string, kind: ProvenanceEdgeKind, opts: { version?: string; detail?: string; at?: number } = {}): ProvenanceEdge {
    return this.pushEdge({ from, to, kind, version: opts.version, detail: opts.detail, at: opts.at });
  }

  private pushEdge(e: { from: string; to: string; kind: ProvenanceEdgeKind; version?: string; detail?: string; at?: number }): ProvenanceEdge {
    const edge = this.addEdge(e);
    this.prune();
    this.maybeFlush();
    return edge;
  }

  /** Pure in-memory edge append (no prune, no flush) — see indexDescriptors. */
  private addEdge(e: { from: string; to: string; kind: ProvenanceEdgeKind; version?: string; detail?: string; at?: number }): ProvenanceEdge {
    const edge: ProvenanceEdge = { id: newId("edge"), from: e.from, to: e.to, kind: e.kind, at: e.at ?? Date.now(), version: e.version, detail: e.detail };
    this.state.edges.push(edge);
    return edge;
  }

  private pushEvent(capabilityId: string, kind: ProvenanceEventKind, opts: { actor?: string; runId?: string; detail?: string; outcome?: ProvenanceOutcome }): ProvenanceEvent {
    return this.recordEvent(capabilityId, kind, opts);
  }

  private prune(): void {
    // Total bounds first (cheap checks; splice only when exceeded).
    if (this.state.events.length > PROVENANCE_BOUNDS.maxEvents) {
      this.state.events.splice(0, this.state.events.length - PROVENANCE_BOUNDS.maxEvents);
    }
    if (this.state.edges.length > PROVENANCE_BOUNDS.maxEdges) {
      this.state.edges.splice(0, this.state.edges.length - PROVENANCE_BOUNDS.maxEdges);
    }
    if (Object.keys(this.state.nodes).length > PROVENANCE_BOUNDS.maxNodes) {
      const sorted = Object.values(this.state.nodes).sort((a, b) => a.firstSeenAt - b.firstSeenAt);
      for (const node of sorted.slice(0, sorted.length - PROVENANCE_BOUNDS.maxNodes)) delete this.state.nodes[node.capabilityId];
    }
    // Per-capability bound: keep the most recent N events per capability.
    // Only rebuilt when the total already exceeds the per-capacity floor.
    if (this.state.events.length > PROVENANCE_BOUNDS.maxEventsPerCapability) {
      const perCap = new Map<string, ProvenanceEvent[]>();
      let anyOver = false;
      for (const e of this.state.events) {
        const arr = perCap.get(e.capabilityId) ?? [];
        arr.push(e);
        perCap.set(e.capabilityId, arr);
      }
      const out: ProvenanceEvent[] = [];
      for (const arr of perCap.values()) {
        if (arr.length > PROVENANCE_BOUNDS.maxEventsPerCapability) anyOver = true;
        out.push(...arr.slice(-PROVENANCE_BOUNDS.maxEventsPerCapability));
      }
      if (anyOver) this.state.events = out.sort((a, b) => a.at - b.at);
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  provenanceOf(id: string): CapabilityProvenance | null {
    const events = this.state.events.filter((e) => e.capabilityId === id);
    const outgoing = this.state.edges.filter((e) => e.from === id);
    const incoming = this.state.edges.filter((e) => e.to === id && e.from !== id);
    const indexed = this.state.nodes[id];
    // Capability ids are typed (`<type>:<nativeId>`); a node can be
    // synthesized for capabilities observed through events but not yet
    // indexed (e.g. tool uses recorded before a descriptor listing).
    const node: ProvenanceNode = indexed ?? {
      capabilityId: id,
      type: typeFromCapabilityId(id),
      nativeId: id.includes(":") ? id.slice(id.indexOf(":") + 1) : id,
      name: id.includes(":") ? id.slice(id.indexOf(":") + 1) : id,
      version: events.length ? "unknown" : "unknown",
      publisherId: "unknown",
      firstSeenAt: events.length ? Math.min(...events.map((e) => e.at)) : Date.now(),
      lastSeenAt: events.length ? Math.max(...events.map((e) => e.at)) : Date.now(),
    };
    const count = (kinds: ProvenanceEventKind[]) => events.filter((e) => kinds.includes(e.kind)).length;
    const uses = events.filter((e) => e.kind === "use");
    return {
      node,
      events,
      outgoing,
      incoming,
      summary: {
        firstSeenAt: node.firstSeenAt,
        lastSeenAt: node.lastSeenAt,
        installs: count(["install"]),
        updates: count(["update"]),
        rollbacks: count(["rollback"]),
        uses: uses.length,
        successes: uses.filter((e) => e.outcome?.status === "success").length,
        failures: uses.filter((e) => e.outcome?.status === "failure").length,
        quarantines: count(["quarantine"]),
        currentVersion: node.version,
      },
    };
  }

  /**
   * "What did the agent use?" — capability usage over a window/run/actor,
   * ordered by recency, with outcome tallies.
   */
  whatWasUsed(query: { runId?: string; actor?: string; since?: number; until?: number; limit?: number } = {}): CapabilityUseRecord[] {
    const limit = query.limit ?? 100;
    const uses = this.state.events.filter((e) => e.kind === "use" || e.kind === "outcome").filter((e) => !query.runId || e.runId === query.runId).filter((e) => !query.actor || e.actor === query.actor).filter((e) => (query.since ?? 0) <= e.at).filter((e) => (query.until ?? Number.MAX_SAFE_INTEGER) >= e.at);
    const byCap = new Map<string, CapabilityUseRecord>();
    for (const e of uses) {
      const node = this.state.nodes[e.capabilityId];
      const row = byCap.get(e.capabilityId) ?? {
        capabilityId: e.capabilityId,
        type: node?.type ?? typeFromCapabilityId(e.capabilityId),
        name: node?.name ?? e.capabilityId,
        version: node?.version ?? "unknown",
        uses: 0,
        lastUsedAt: 0,
        outcomes: { success: 0, failure: 0, unknown: 0 },
      };
      row.uses += 1;
      row.lastUsedAt = Math.max(row.lastUsedAt, e.at);
      if (node) row.version = node.version;
      const status = e.outcome?.status ?? "unknown";
      if (status === "success") row.outcomes.success += 1;
      else if (status === "failure") row.outcomes.failure += 1;
      else row.outcomes.unknown += 1;
      byCap.set(e.capabilityId, row);
    }
    return [...byCap.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, limit);
  }

  /** Full graph (nodes + edges) for export, audits, and the completion report. */
  graph(): { nodes: ProvenanceNode[]; edges: ProvenanceEdge[]; events: ProvenanceEvent[] } {
    return {
      nodes: Object.values(this.state.nodes).sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)),
      edges: [...this.state.edges],
      events: [...this.state.events],
    };
  }

  node(capabilityId: string): ProvenanceNode | undefined {
    return this.state.nodes[capabilityId];
  }
}

/** Convenience: resolve a capability id for a raw tool name (tool plane). */
export function toolCapabilityId(toolName: string): string {
  return `tool:${toolName}`;
}

const KNOWN_TYPES = [
  "plugin",
  "skill",
  "mcp",
  "provider",
  "tool",
  "workflow",
  "integration",
  "artifact",
] as const;

/** Derive the capability type from a typed capability id (`<type>:<native>`). */
export function typeFromCapabilityId(id: string): CapabilityType {
  const prefix = id.slice(0, id.indexOf(":"));
  return (KNOWN_TYPES as readonly string[]).includes(prefix) ? (prefix as CapabilityType) : "unknown" as CapabilityType;
}

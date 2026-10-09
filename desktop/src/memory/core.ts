/*
 * Memory Explorer (Phase 21) — pure core. No React, no fetch, no store.
 *
 * Everything the screen *decides* lives here so it can be tested under the
 * root `bun test` lane: filtering, expiry labels, linked entries, search
 * highlights, import validation, the restore payload for Undo, and the graph
 * layout. The engine remains the authority for what is stored, recalled,
 * flagged or exported; these helpers only shape what the user sees.
 */

export type MemoryCategory = 'preference' | 'project' | 'workflow' | 'fact' | 'exclusion';
export type MemorySource = 'user' | 'chat' | 'voice' | 'research' | 'import' | 'tool' | 'agent' | 'schedule';
export type SensitiveKind = 'credit-card' | 'ssn' | 'api-key' | 'private-key';

/** One memory as the engine returns it (src/daemon/routes/memory.routes.ts `view()`). */
export interface MemoryView {
  id: string;
  category: MemoryCategory;
  content: string;
  scope: string;
  source: MemorySource;
  kind: string | null;
  tags: string[];
  importance: number;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number | null;
  accessCount: number;
  consentState: string;
  provenanceKind: string | null;
  provenanceRef: string | null;
  sensitive: SensitiveKind[];
}

export type GraphNodeKind = 'you' | 'fact' | 'person' | 'project' | 'file' | 'tool' | 'model' | 'org';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  importance: number;
  memoryIds: string[];
  linkCount: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
}

export interface MemoryGraphData {
  method: 'heuristic';
  root: 'me';
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export type CategoryFilter = 'all' | 'preference' | 'fact' | 'project' | 'workflow' | 'exclusion' | 'entities';
export type ScopeFilter = 'all' | 'global' | 'workspace';

export const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  preference: 'Preference',
  fact: 'Fact',
  project: 'Project',
  workflow: 'Workflow',
  exclusion: 'Do not remember',
};

export const SOURCE_LABEL: Record<MemorySource, string> = {
  user: 'You',
  chat: 'Chat',
  voice: 'Voice',
  research: 'Research',
  import: 'Imported',
  tool: 'Tool',
  agent: 'Agent',
  schedule: 'Scheduled',
};

export const SENSITIVE_LABEL: Record<SensitiveKind, string> = {
  'credit-card': 'Looks like a payment card number',
  ssn: 'Looks like a social security number',
  'api-key': 'Looks like an API key or access token',
  'private-key': 'Contains a private key block',
};

/** Tag prefixes that mark an entity (see src/context/memory/graph.ts). */
const ENTITY_TAG_PREFIX = /^(person|org|project|file|tool|model|integration):/i;

export const EXPIRY_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Never' },
  { value: 30, label: 'After 30 days' },
  { value: 90, label: 'After 90 days' },
  { value: 365, label: 'After a year' },
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function isEntity(e: Pick<MemoryView, 'tags'>): boolean {
  return e.tags.some((t) => ENTITY_TAG_PREFIX.test(t));
}

/** 'global' or 'workspace' — the two scopes a user can pick in the UI. */
export function scopeKind(scope: string): 'global' | 'workspace' {
  return scope === 'global' ? 'global' : 'workspace';
}

export function isExpired(e: Pick<MemoryView, 'expiresAt'>, now: number): boolean {
  return typeof e.expiresAt === 'number' && e.expiresAt <= now;
}

export interface FilterOptions {
  category?: CategoryFilter;
  scope?: ScopeFilter;
  showExpired?: boolean;
  /** Ids returned by the engine's search for the current query; undefined = no query. */
  matchIds?: ReadonlySet<string> | null;
  now?: number;
}

/** Filter + order the list. Order: importance desc, then most recently updated. */
export function filterMemories(entries: readonly MemoryView[], opts: FilterOptions = {}): MemoryView[] {
  const now = opts.now ?? Date.now();
  const category = opts.category ?? 'all';
  const scope = opts.scope ?? 'all';
  const out = entries.filter((e) => {
    if (!opts.showExpired && isExpired(e, now)) return false;
    if (category === 'entities') {
      if (!isEntity(e)) return false;
    } else if (category !== 'all' && e.category !== category) {
      return false;
    }
    if (scope !== 'all' && scopeKind(e.scope) !== scope) return false;
    if (opts.matchIds && !opts.matchIds.has(e.id)) return false;
    return true;
  });
  return out.sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt);
}

/** Count per category chip, computed over the same visibility rules as the list. */
export function countByCategory(entries: readonly MemoryView[], now: number = Date.now()): Record<CategoryFilter, number> {
  const counts: Record<CategoryFilter, number> = { all: 0, preference: 0, fact: 0, project: 0, workflow: 0, exclusion: 0, entities: 0 };
  for (const e of entries) {
    if (isExpired(e, now)) continue;
    counts.all++;
    counts[e.category]++;
    if (isEntity(e)) counts.entities++;
  }
  return counts;
}

export interface Segment {
  text: string;
  match: boolean;
}

/** Split text into plain / matched segments for <mark> rendering (no HTML). */
export function highlightSegments(text: string, query: string): Segment[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const terms = q.split(/\s+/).filter(Boolean).map(escapeRe);
  const re = new RegExp(`(${terms.join('|')})`, 'gi');
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), match: false });
    out.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out.length ? out : [{ text, match: false }];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First line, clipped — the list row title. */
export function summarize(content: string, max = 80): string {
  const one = content.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function relativeTime(ts: number, now: number = Date.now()): string {
  const d = Math.max(0, now - ts);
  if (d < MINUTE) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 30 * DAY) return `${Math.floor(d / DAY)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function expiryText(expiresAt: number | null, now: number = Date.now()): string {
  if (expiresAt == null) return 'Never expires';
  if (expiresAt <= now) return 'Expired';
  const left = expiresAt - now;
  if (left < DAY) return 'Expires today';
  return `Expires in ${Math.ceil(left / DAY)} days`;
}

/** Days remaining → the nearest expiry option value, for the editor's <select>. */
export function expiryOptionFor(expiresAt: number | null, now: number = Date.now()): number | null {
  if (expiresAt == null) return null;
  const days = Math.max(0, (expiresAt - now) / DAY);
  let best = EXPIRY_OPTIONS[1]!.value!;
  for (const o of EXPIRY_OPTIONS) {
    if (o.value == null) continue;
    if (Math.abs(o.value - days) < Math.abs(best - days)) best = o.value;
  }
  return best;
}

/** Other memories that share a tag with this one, strongest overlap first. */
export function linkedEntries(entry: MemoryView, all: readonly MemoryView[], limit = 5): MemoryView[] {
  const mine = new Set(entry.tags.filter((t) => !t.startsWith('source:')));
  if (mine.size === 0) return [];
  const scored: Array<{ e: MemoryView; shared: number }> = [];
  for (const other of all) {
    if (other.id === entry.id) continue;
    let shared = 0;
    for (const t of other.tags) if (mine.has(t)) shared++;
    if (shared > 0) scored.push({ e: other, shared });
  }
  scored.sort((a, b) => b.shared - a.shared || b.e.importance - a.e.importance);
  return scored.slice(0, limit).map((s) => s.e);
}

/** Tags that are safe to show as chips (hides engine bookkeeping like `source:…`). */
export function userTags(tags: readonly string[]): string[] {
  return tags.filter((t) => !t.startsWith('source:'));
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 60))].slice(0, 20);
}

export interface ImportPreview {
  ok: boolean;
  count: number;
  reason?: string;
}

/** Client-side precheck for a picked file. The engine validates again on import. */
export function previewImport(text: string): ImportPreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, count: 0, reason: 'That file is not valid JSON.' };
  }
  const b = parsed as { format?: unknown; entries?: unknown };
  if (!b || b.format !== 'xr-memory' || !Array.isArray(b.entries)) {
    return { ok: false, count: 0, reason: 'This is not an XR memory export (expected format "xr-memory").' };
  }
  if (b.entries.length > 5000) return { ok: false, count: b.entries.length, reason: 'This file has more than 5,000 memories.' };
  return { ok: true, count: b.entries.length };
}

/** Body for re-creating a just-deleted memory (Undo). The id is new; content and provenance are kept. */
export function restoreBody(e: MemoryView): {
  content: string;
  category: MemoryCategory;
  scope: string;
  tags: string[];
  importance: number;
  expiresInDays: number | null;
  acknowledgeSensitive?: true;
} {
  const days = e.expiresAt == null ? null : Math.max(1, Math.ceil((e.expiresAt - Date.now()) / DAY));
  return {
    content: e.content,
    category: e.category,
    scope: e.scope,
    tags: userTags(e.tags),
    importance: e.importance,
    expiresInDays: days,
    ...(e.sensitive.length > 0 ? { acknowledgeSensitive: true as const } : {}),
  };
}

// ── graph layout ────────────────────────────────────────────────────────────

export const ENTITY_COLOR: Record<GraphNodeKind, string> = {
  you: 'var(--accent)',
  fact: '#FACC15',
  person: '#A78BFA',
  project: 'var(--accent)',
  file: '#FB923C',
  tool: '#4ADE80',
  model: '#60A5FA',
  org: '#F472B6',
};

export const ENTITY_LABEL: Record<GraphNodeKind, string> = {
  you: 'You',
  fact: 'Memory',
  person: 'Person',
  project: 'Project',
  file: 'File',
  tool: 'Tool',
  model: 'Model',
  org: 'Organisation',
};

/** Node radius in px. You is largest; others scale with importance and degree (8–22). */
export function nodeRadius(n: Pick<GraphNode, 'kind' | 'importance' | 'linkCount'>): number {
  if (n.kind === 'you') return 30;
  const r = 8 + n.importance * 1.6 + Math.min(n.linkCount, 6) * 0.9;
  return Math.min(22, Math.round(r * 10) / 10);
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Deterministic force layout: 'You' is pinned at the origin; other nodes start
 * on rings by kind and relax under repulsion + edge springs. No randomness, no
 * animation loop — the result is the same on every render and reduced-motion
 * users get it instantly.
 */
export function layoutGraph(graph: Pick<MemoryGraphData, 'nodes' | 'edges'>, iterations = 300): Map<string, Point> {
  const pos = new Map<string, Point>();
  const others = graph.nodes.filter((n) => n.kind !== 'you');
  const ringFor = (k: GraphNodeKind) => (k === 'fact' ? 260 : k === 'person' || k === 'org' ? 150 : 190);
  others.forEach((n, i) => {
    const angle = (i / Math.max(1, others.length)) * Math.PI * 2;
    const r = ringFor(n.kind);
    pos.set(n.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  });
  pos.set('me', { x: 0, y: 0 });
  const ids = others.map((n) => n.id);
  const dynamic = new Map(ids.map((id) => [id, pos.get(id)!]));
  const vel = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
  const edgeList = graph.edges.filter((e) => pos.has(e.source) && pos.has(e.target));
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    const force = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    // Repulsion between all movable nodes (n is capped at 300, so O(n²) is fine).
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = dynamic.get(ids[i]!)!;
        const b = dynamic.get(ids[j]!)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = Math.max(64, dx * dx + dy * dy);
        const f = 2200 / d2;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        force.get(ids[i]!)!.x += dx * f;
        force.get(ids[i]!)!.y += dy * f;
        force.get(ids[j]!)!.x -= dx * f;
        force.get(ids[j]!)!.y -= dy * f;
      }
    }
    // Springs along edges (the You node counts as an anchor, not a mover).
    for (const e of edgeList) {
      const sMove = dynamic.has(e.source);
      const tMove = dynamic.has(e.target);
      if (!sMove && !tMove) continue;
      const a = pos.get(e.source)!;
      const b = pos.get(e.target)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const rest = 120;
      const f = (d - rest) * 0.02;
      if (sMove) {
        force.get(e.source)!.x += (dx / d) * f;
        force.get(e.source)!.y += (dy / d) * f;
      }
      if (tMove) {
        force.get(e.target)!.x -= (dx / d) * f;
        force.get(e.target)!.y -= (dy / d) * f;
      }
    }
    for (const id of ids) {
      const p = dynamic.get(id)!;
      const v = vel.get(id)!;
      const fo = force.get(id)!;
      // Weak gravity keeps disconnected clusters from drifting away.
      v.x = (v.x + fo.x - p.x * 0.004) * 0.85;
      v.y = (v.y + fo.y - p.y * 0.004) * 0.85;
      // Clamp speed so a dense start cannot fling nodes off-canvas.
      const speed = Math.hypot(v.x, v.y);
      if (speed > 24) {
        v.x = (v.x / speed) * 24;
        v.y = (v.y / speed) * 24;
      }
      const step = 1 * (0.3 + 0.7 * cool);
      p.x += v.x * step;
      p.y += v.y * step;
    }
  }
  for (const id of ids) pos.set(id, dynamic.get(id)!);
  return pos;
}

/** Ids of nodes and edges touching `nodeId` — drives the hover highlight. */
export function neighborhood(graph: Pick<MemoryGraphData, 'edges'>, nodeId: string | null): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (!nodeId) return { nodes, edges };
  nodes.add(nodeId);
  for (const e of graph.edges) {
    if (e.source === nodeId || e.target === nodeId) {
      edges.add(e.id);
      nodes.add(e.source);
      nodes.add(e.target);
    }
  }
  return { nodes, edges };
}

export const PLURAL: Record<GraphNodeKind, string> = {
  you: 'You',
  fact: 'Memories',
  person: 'People',
  project: 'Projects',
  file: 'Files',
  tool: 'Tools',
  model: 'Models',
  org: 'Organisations',
};

/** Plain outline of the graph for the "Show as text" fallback (screen readers, keyboard). */
export function graphOutline(graph: MemoryGraphData): Array<{ heading: string; items: string[] }> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const groups: Array<{ heading: string; items: string[] }> = [];
  const kinds: GraphNodeKind[] = ['person', 'project', 'org', 'tool', 'model', 'file', 'fact'];
  for (const k of kinds) {
    const nodes = graph.nodes.filter((n) => n.kind === k);
    if (nodes.length === 0) continue;
    groups.push({
      heading: PLURAL[k],
      items: nodes.map((n) => {
        const rels = graph.edges
          .filter((e) => e.target === n.id || e.source === n.id)
          .map((e) => {
            const other = byId.get(e.source === n.id ? e.target : e.source);
            return other ? `${e.relation} ${other.label}` : null;
          })
          .filter((x): x is string => x !== null)
          .slice(0, 3);
        return rels.length ? `${n.label} (${rels.join('; ')})` : n.label;
      }),
    });
  }
  return groups;
}

export const GRAPH_NODE_LIMIT = 300;

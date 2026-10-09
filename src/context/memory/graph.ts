/**
 * Phase 21 — memory entity graph (heuristic, read-only).
 *
 * Turns durable memory entries into a small constellation: the user at the
 * centre, one node per memory, and entity nodes (people, projects, files,
 * tools, models, orgs) pulled out of the entry text. It is a navigation
 * surface over memories that already exist — it never writes, and every
 * node lists the memory ids it came from so the UI can show *why* it is there.
 *
 * Extraction is regex + explicit tags, labelled `method: "heuristic"`. No
 * model call is made here; an LLM pass can replace `extractEntities` later
 * without changing the response shape.
 */
import { scanSensitive } from "./sensitivity.ts";

export type GraphNodeKind = "you" | "fact" | "person" | "project" | "file" | "tool" | "model" | "org";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Highest importance (1–5) among the memories that reference this node. */
  importance: number;
  /** Memory ids this node was derived from (empty for `you`). */
  memoryIds: string[];
  /** Degree in the returned graph. */
  linkCount: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
}

export interface MemoryGraph {
  method: "heuristic";
  root: "me";
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** True when nodes were dropped to stay within `maxNodes`. */
  truncated: boolean;
}

export interface GraphInputEntry {
  id: string;
  category: string;
  content: string;
  scope: string;
  tags: string[];
  importance: number;
}

const YOU = "me";
const MAX_LABEL = 48;
const DEFAULT_MAX_NODES = 300;

const TAG_KINDS: Record<string, GraphNodeKind> = {
  person: "person",
  project: "project",
  file: "file",
  tool: "tool",
  model: "model",
  org: "org",
};

const KNOWN_TOOLS = ["Vim", "Neovim", "VS Code", "Git", "GitHub", "Tauri", "React", "TypeScript", "Rust", "Python", "Bun", "Docker", "Figma", "Notion"];
const KNOWN_MODELS = ["Ollama", "Claude", "GPT", "Gemini", "Llama", "Mistral", "Qwen"];

const FILE_RE = /(?:^|[\s(`'"])((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.@-]+)+\.[A-Za-z0-9]{1,6}|[\w-]+\.(?:ts|tsx|js|jsx|md|json|py|rs|go|toml|yaml|yml|csv|pdf|docx|xlsx))(?=$|[\s).,;:`'"])/g;
const PERSON_RE = /\b(?:colleague|friend|manager|boss|wife|husband|partner|brother|sister|mentor|teammate|co-?founder|client|named|called)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g;

function clip(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1)}…` : t;
}

function normKey(s: string): string {
  return s.trim().toLowerCase();
}

interface Entity {
  kind: GraphNodeKind;
  label: string;
}

/** Entities mentioned by one entry. Explicit `kind:name` tags win over text heuristics. */
export function extractEntities(entry: GraphInputEntry): Entity[] {
  const out = new Map<string, Entity>();
  const add = (kind: GraphNodeKind, label: string) => {
    const clean = label.trim();
    if (!clean || clean.length > MAX_LABEL) return;
    out.set(`${kind}:${normKey(clean)}`, { kind, label: clean });
  };
  for (const tag of entry.tags) {
    const idx = tag.indexOf(":");
    if (idx <= 0) continue;
    const kind = TAG_KINDS[tag.slice(0, idx).toLowerCase()];
    if (kind) add(kind, tag.slice(idx + 1));
  }
  // A workspace-scoped project memory is about that project.
  // The generic "workspace" key is not a project name; only a named project key is.
  const namedProject = entry.scope && entry.scope !== "global" && entry.scope !== "workspace" && !entry.scope.includes(":");
  if (entry.category === "project" && namedProject) {
    add("project", entry.scope);
  }
  for (const m of entry.content.matchAll(FILE_RE)) add("file", m[1]!);
  for (const m of entry.content.matchAll(PERSON_RE)) add("person", m[1]!);
  for (const t of KNOWN_TOOLS) if (new RegExp(`\\b${t.replace(/\s/g, "\\s")}\\b`, "i").test(entry.content)) add("tool", t);
  for (const m of KNOWN_MODELS) if (new RegExp(`\\b${m}\\b`).test(entry.content)) add("model", m);
  return [...out.values()];
}

const RELATION_FROM_MEMORY: Record<GraphNodeKind, string> = {
  you: "",
  fact: "",
  person: "mentions",
  project: "about",
  file: "references",
  tool: "uses",
  model: "uses",
  org: "mentions",
};

const RELATION_FROM_YOU: Partial<Record<GraphNodeKind, string>> = {
  person: "knows",
  project: "works on",
  tool: "uses",
  model: "uses",
  file: "has file",
  org: "relates to",
};

/**
 * Build the graph for the current user. Exclusion rules are never graphed
 * (they are policy, not knowledge) and sensitive entries are drawn without
 * their content.
 */
export function buildMemoryGraph(entries: GraphInputEntry[], opts: { maxNodes?: number } = {}): MemoryGraph {
  const maxNodes = Math.max(10, opts.maxNodes ?? DEFAULT_MAX_NODES);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  nodes.set(YOU, { id: YOU, kind: "you", label: "You", importance: 5, memoryIds: [], linkCount: 0 });

  const touch = (id: string, kind: GraphNodeKind, label: string, importance: number, memoryId: string) => {
    let n = nodes.get(id);
    if (!n) {
      n = { id, kind, label, importance: 1, memoryIds: [], linkCount: 0 };
      nodes.set(id, n);
    }
    n.importance = Math.max(n.importance, importance);
    if (memoryId && !n.memoryIds.includes(memoryId)) n.memoryIds.push(memoryId);
    return n;
  };
  const link = (source: string, target: string, relation: string) => {
    if (!relation || source === target) return;
    const id = `${source}|${relation}|${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target, relation });
  };

  for (const e of entries) {
    if (e.category === "exclusion") continue;
    const sensitive = scanSensitive(e.content).length > 0;
    const factId = `fact:${e.id}`;
    const label = sensitive ? "Sensitive entry" : clip(e.content);
    touch(factId, "fact", label, e.importance, e.id);
    link(YOU, factId, "remembers");

    const entities = extractEntities(e);
    const ids: string[] = [];
    for (const ent of entities) {
      const id = `${ent.kind}:${normKey(ent.label)}`;
      touch(id, ent.kind, ent.label, e.importance, e.id);
      link(factId, id, RELATION_FROM_MEMORY[ent.kind]);
      const fromYou = RELATION_FROM_YOU[ent.kind];
      if (fromYou) link(YOU, id, fromYou);
      ids.push(id);
    }
    // Entities that appear in the same memory are related to each other.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length && j < i + 4; j++) link(ids[i]!, ids[j]!, "appears with");
    }
  }

  // Degree counts over the full graph, then cap.
  for (const ed of edges.values()) {
    const s = nodes.get(ed.source);
    const t = nodes.get(ed.target);
    if (s) s.linkCount++;
    if (t) t.linkCount++;
  }

  let truncated = false;
  let kept = [...nodes.values()];
  if (kept.length > maxNodes) {
    truncated = true;
    const rest = kept
      .filter((n) => n.id !== YOU)
      .sort((a, b) => b.importance - a.importance || b.linkCount - a.linkCount || a.id.localeCompare(b.id))
      .slice(0, maxNodes - 1);
    kept = [nodes.get(YOU)!, ...rest];
  }
  const keptIds = new Set(kept.map((n) => n.id));
  const keptEdges = [...edges.values()].filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
  // Recount degree on the kept subgraph so the UI sizes what it draws.
  for (const n of kept) n.linkCount = 0;
  for (const e of keptEdges) {
    nodes.get(e.source)!.linkCount++;
    nodes.get(e.target)!.linkCount++;
  }
  return { method: "heuristic", root: "me", nodes: kept, edges: keptEdges, truncated };
}

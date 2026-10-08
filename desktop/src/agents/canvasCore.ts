/*
 * Workflow canvas core (Phase 19) — pure helpers between React Flow and the
 * engine's `CanvasGraph` (src/execution/workflow/canvas.ts).
 *
 * The canvas is a VIEW of the canonical workflow: what the user draws is
 * compiled DOWN to `WorkflowDefinition` by the engine (`POST /workflows`,
 * `/workflows/inspect`); nothing here invents a second format. These
 * helpers only shape nodes/edges for React Flow, lay them out, describe
 * them for assistive tech and keep ids stable.
 */
import type { Edge, Node } from '@xyflow/react';

import type { CanvasEdge, CanvasGraph, CanvasNode, CanvasNodeKind, WorkflowParameter, WorkflowProblem } from './api';

/* ── Node catalogue ───────────────────────────────────────────────────── */

export type PaletteGroup = 'flow' | 'ai' | 'actions' | 'human';

export interface NodeKindMeta {
  kind: CanvasNodeKind;
  label: string;
  group: PaletteGroup;
  /** CSS colour expression (rides theme tokens where one exists). */
  color: string;
  shape: 'card' | 'pill';
  /** Source handles; branch exposes two labelled ports. */
  sources: readonly string[];
  targets: readonly string[];
  hint: string;
}

export const NODE_KINDS: readonly NodeKindMeta[] = [
  { kind: 'input', label: 'Input', group: 'flow', color: 'var(--success)', shape: 'pill', sources: ['out'], targets: [], hint: 'A run parameter the workflow asks for.' },
  { kind: 'output', label: 'Output', group: 'flow', color: 'var(--danger)', shape: 'pill', sources: [], targets: ['in'], hint: 'Ends the workflow with a message.' },
  { kind: 'branch', label: 'Branch', group: 'flow', color: 'var(--cat-approval)', shape: 'card', sources: ['true', 'false'], targets: ['in'], hint: 'Routes on a field of an earlier node.' },
  { kind: 'join', label: 'Join', group: 'flow', color: 'var(--agent-planner)', shape: 'card', sources: ['out'], targets: ['in'], hint: 'Waits for every incoming path (or the first N).' },
  { kind: 'wait', label: 'Wait', group: 'flow', color: 'var(--text-tertiary)', shape: 'card', sources: ['out'], targets: ['in'], hint: 'Pauses for a delay or an event.' },
  { kind: 'llm', label: 'LLM', group: 'ai', color: 'var(--accent)', shape: 'card', sources: ['out'], targets: ['in'], hint: 'One agentic step with an instruction and a cost cap.' },
  { kind: 'subagent', label: 'Sub-agent', group: 'ai', color: 'var(--accent)', shape: 'card', sources: ['out'], targets: ['in'], hint: 'Delegates to a prebuilt or custom agent.' },
  { kind: 'tool', label: 'Tool', group: 'actions', color: 'var(--cat-tool)', shape: 'card', sources: ['out'], targets: ['in'], hint: 'Calls one engine tool with fixed arguments.' },
  { kind: 'notification', label: 'Notification', group: 'actions', color: 'var(--agent-planner)', shape: 'card', sources: ['out'], targets: ['in'], hint: 'Posts a message to you.' },
  { kind: 'artifact', label: 'Artifact', group: 'actions', color: 'var(--cat-file)', shape: 'card', sources: ['out'], targets: ['in'], hint: 'Declares a file the run produces.' },
  { kind: 'human_approval', label: 'Approval', group: 'human', color: 'var(--warning)', shape: 'card', sources: ['out'], targets: ['in'], hint: 'Blocks until you approve or deny. Enforced by the engine.' },
  { kind: 'human_review', label: 'Review', group: 'human', color: 'var(--warning)', shape: 'card', sources: ['out'], targets: ['in'], hint: 'Blocks until you accept, request changes or reject.' },
];

export const PALETTE_GROUPS: readonly { id: PaletteGroup; label: string }[] = [
  { id: 'flow', label: 'Flow' },
  { id: 'ai', label: 'AI' },
  { id: 'actions', label: 'Actions' },
  { id: 'human', label: 'Human' },
];

const META = new Map(NODE_KINDS.map((m) => [m.kind, m]));

export function kindMeta(kind: CanvasNodeKind): NodeKindMeta {
  return META.get(kind) ?? NODE_KINDS[5];
}

export function isCanvasKind(v: unknown): v is CanvasNodeKind {
  return typeof v === 'string' && META.has(v as CanvasNodeKind);
}

/** Mirrors `defaultConfig` in src/execution/workflow/canvas.ts. */
export function defaultConfig(kind: CanvasNodeKind): Record<string, unknown> {
  switch (kind) {
    case 'input':
      return { paramName: '', paramType: 'string', required: false, defaultValue: '', description: '' };
    case 'llm':
      return { agentRole: 'executor', instruction: '', systemPrompt: '', provider: '', model: '', maxUsd: 0.5, maxSteps: 8, tools: [], riskTier: 'low', requiresReview: false };
    case 'subagent':
      return { agentId: '', instruction: '', maxUsd: 0.5, maxSteps: 8 };
    case 'tool':
      return { tool: '', args: {}, requiresApproval: false, maxRetries: 0, backoffMs: 1000, riskTier: 'medium' };
    case 'branch':
      return { conditionType: 'field_compare', field: '', operator: 'eq', value: '', expression: '', nodeId: '' };
    case 'join':
      return { strategy: 'all', n: 1, timeoutMs: 0, onTimeout: 'fail' };
    case 'human_approval':
      return { summary: '', detail: '', riskLevel: 'medium', approver: 'any_human', expiresInMs: 86_400_000, onExpiry: 'deny', onDenial: 'stop_workflow' };
    case 'human_review':
      return { summary: '', detail: '', expiresInMs: 86_400_000, onChangeRequested: 'retry_targets', onExpiry: 'block' };
    case 'wait':
      return { mode: 'delay', durationMs: 5000, eventName: '' };
    case 'notification':
      return { message: '', severity: 'info', recipient: 'user' };
    case 'artifact':
      return { type: 'report', format: 'markdown', description: '', storagePath: '' };
    case 'output':
      return { message: '', outcome: 'success' };
  }
}

/* ── React Flow shapes ────────────────────────────────────────────────── */

export interface XrNodeData extends Record<string, unknown> {
  kind: CanvasNodeKind;
  label: string;
  config: Record<string, unknown>;
}

export type XrFlowNode = Node<XrNodeData, 'xr'>;
export type XrFlowEdge = Edge;

export const NODE_W = 220;
export const NODE_H = 64;
export const PILL_W = 160;
export const PILL_H = 40;

export function nodeSize(kind: CanvasNodeKind): { w: number; h: number } {
  return kindMeta(kind).shape === 'pill' ? { w: PILL_W, h: PILL_H } : { w: NODE_W, h: NODE_H };
}

let seq = 0;
export function newNodeId(kind: CanvasNodeKind): string {
  seq += 1;
  return `n_${kind}_${(Date.now() % 1_000_000).toString(36)}${(seq % 1296).toString(36).padStart(2, '0')}`;
}

export function edgeId(source: string, target: string, handle?: string | null): string {
  return `e_${source}_${target}${handle && handle !== 'out' ? `_${handle}` : ''}`;
}

export function makeNode(kind: CanvasNodeKind, position: { x: number; y: number }, overrides: Partial<XrNodeData> = {}): XrFlowNode {
  const meta = kindMeta(kind);
  return {
    id: newNodeId(kind),
    type: 'xr',
    position,
    data: { kind, label: meta.label, config: defaultConfig(kind), ...overrides },
  };
}

export function toFlow(graph: CanvasGraph): { nodes: XrFlowNode[]; edges: XrFlowEdge[] } {
  const nodes: XrFlowNode[] = graph.nodes.map((n) => ({
    id: n.id,
    type: 'xr',
    position: { x: n.position.x, y: n.position.y },
    data: { kind: n.kind, label: n.label, config: { ...defaultConfig(n.kind), ...n.config } },
  }));
  const edges: XrFlowEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? 'out',
    targetHandle: e.targetHandle ?? 'in',
    type: 'xr',
  }));
  return { nodes, edges };
}

export function toGraph(nodes: XrFlowNode[], edges: XrFlowEdge[]): CanvasGraph {
  const ids = new Set(nodes.map((n) => n.id));
  const outNodes: CanvasNode[] = nodes.map((n) => ({
    id: n.id,
    kind: n.data.kind,
    label: n.data.label,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    config: n.data.config,
  }));
  const outEdges: CanvasEdge[] = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle && e.sourceHandle !== 'out' ? e.sourceHandle : null,
      targetHandle: null,
    }));
  return { nodes: outNodes, edges: outEdges };
}

/** Connection rules the UI enforces before the engine lints: no self loops, one edge per (source, handle, target), respect port counts. */
export function canConnect(nodes: XrFlowNode[], edges: XrFlowEdge[], c: { source: string; target: string; sourceHandle?: string | null }): boolean {
  if (c.source === c.target) return false;
  const src = nodes.find((n) => n.id === c.source);
  const tgt = nodes.find((n) => n.id === c.target);
  if (!src || !tgt) return false;
  if (kindMeta(src.data.kind).sources.length === 0) return false;
  if (kindMeta(tgt.data.kind).targets.length === 0) return false;
  const handle = c.sourceHandle ?? 'out';
  if (edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? 'out') === handle)) return false;
  // Branch ports are exclusive: one outgoing path per outcome.
  if (src.data.kind === 'branch' && edges.some((e) => e.source === c.source && (e.sourceHandle ?? 'out') === handle)) return false;
  return !wouldCycle(edges, c.source, c.target);
}

function wouldCycle(edges: XrFlowEdge[], source: string, target: string): boolean {
  // Adding source→target creates a cycle iff source is reachable from target.
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of out.get(id) ?? []) stack.push(n);
  }
  return false;
}

/* ── Layout ───────────────────────────────────────────────────────────── */

/** Longest-path layering, barycentre ordering; simple, deterministic. */
export function layerLayout(nodes: XrFlowNode[], edges: XrFlowEdge[]): XrFlowNode[] {
  if (nodes.length === 0) return nodes;
  const ids = nodes.map((n) => n.id);
  const inc = new Map<string, string[]>();
  const out = new Map<string, string[]>();
  for (const id of ids) {
    inc.set(id, []);
    out.set(id, []);
  }
  for (const e of edges) {
    if (!inc.has(e.target) || !out.has(e.source)) continue;
    inc.get(e.target)!.push(e.source);
    out.get(e.source)!.push(e.target);
  }
  const layer = new Map<string, number>();
  const indeg = new Map(ids.map((id) => [id, inc.get(id)!.length]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (const id of queue) layer.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of out.get(id)!) {
      layer.set(t, Math.max(layer.get(t) ?? 0, (layer.get(id) ?? 0) + 1));
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0); // cycles (lint rejects them) still get a slot
  const byLayer = new Map<number, string[]>();
  for (const id of ids) byLayer.set(layer.get(id)!, [...(byLayer.get(layer.get(id)!) ?? []), id]);
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const order = new Map<string, number>();
  for (const l of layers) {
    const members = byLayer.get(l)!;
    if (l === layers[0]) members.forEach((id, i) => order.set(id, i));
    else {
      const bary = (id: string): number => {
        const ps = inc.get(id)!.filter((p) => order.has(p));
        return ps.length ? ps.reduce((s, p) => s + order.get(p)!, 0) / ps.length : Number.MAX_SAFE_INTEGER;
      };
      members.sort((a, b) => bary(a) - bary(b) || a.localeCompare(b));
      members.forEach((id, i) => order.set(id, i));
    }
  }
  const GAP_X = 300;
  const GAP_Y = 110;
  const positioned = new Map<string, { x: number; y: number }>();
  const tallest = Math.max(...layers.map((l) => byLayer.get(l)!.length));
  for (const l of layers) {
    const members = byLayer.get(l)!;
    const offset = ((tallest - members.length) * GAP_Y) / 2;
    members.forEach((id, i) => {
      const node = nodes.find((n) => n.id === id)!;
      const size = nodeSize(node.data.kind);
      positioned.set(id, { x: 80 + l * GAP_X + (NODE_W - size.w) / 2, y: 80 + offset + i * GAP_Y + (NODE_H - size.h) / 2 });
    });
  }
  return nodes.map((n) => ({ ...n, position: positioned.get(n.id) ?? n.position }));
}

/* ── Parameters (Input nodes → run form) ──────────────────────────────── */

export function parametersOf(nodes: XrFlowNode[]): WorkflowParameter[] {
  return nodes
    .filter((n) => n.data.kind === 'input')
    .map((n) => {
      const c = n.data.config;
      return {
        name: String(c.paramName ?? '').trim(),
        type: String(c.paramType ?? 'string'),
        required: c.required === true,
        description: String(c.description ?? ''),
        defaultValue: c.defaultValue === '' ? undefined : c.defaultValue,
      };
    })
    .filter((p) => p.name);
}

/* ── Describe (screen readers, honest chip) ───────────────────────────── */

export function graphCounts(nodes: XrFlowNode[]): { nodes: number; tools: number; humanChecks: number; llmSteps: number } {
  return {
    nodes: nodes.length,
    tools: nodes.filter((n) => n.data.kind === 'tool').length,
    humanChecks: nodes.filter((n) => n.data.kind === 'human_approval' || n.data.kind === 'human_review').length,
    llmSteps: nodes.filter((n) => n.data.kind === 'llm' || n.data.kind === 'subagent').length,
  };
}

export function countsLine(c: { nodes: number; tools: number; humanChecks: number; llmSteps: number }): string {
  const parts = [`${c.nodes} ${c.nodes === 1 ? 'node' : 'nodes'}`];
  if (c.llmSteps) parts.push(`${c.llmSteps} ${c.llmSteps === 1 ? 'LLM step' : 'LLM steps'}`);
  if (c.tools) parts.push(`${c.tools} ${c.tools === 1 ? 'tool' : 'tools'}`);
  if (c.humanChecks) parts.push(`${c.humanChecks} human ${c.humanChecks === 1 ? 'check' : 'checks'}`);
  return parts.join(' · ');
}

/** Plain-language walk of the graph for the "Describe workflow" live region. */
export function describeGraph(name: string, nodes: XrFlowNode[], edges: XrFlowEdge[]): string {
  if (nodes.length === 0) return `${name || 'Untitled workflow'} is empty.`;
  const laid = layerLayout(nodes, edges);
  const ordered = [...laid].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const label = (n: XrFlowNode): string => `${kindMeta(n.data.kind).label} “${n.data.label}”`;
  const steps = ordered.map((n) => {
    const outs = edges.filter((e) => e.source === n.id).map((e) => {
      const t = nodes.find((x) => x.id === e.target);
      const via = n.data.kind === 'branch' ? ` on ${e.sourceHandle ?? 'true'}` : '';
      return t ? `${t.data.label}${via}` : null;
    }).filter(Boolean);
    return outs.length ? `${label(n)} → ${outs.join(', ')}` : `${label(n)} (end)`;
  });
  return `${name || 'Untitled workflow'}: ${countsLine(graphCounts(nodes))}, ${edges.length} ${edges.length === 1 ? 'connection' : 'connections'}. ${steps.join('. ')}.`;
}

/* ── Problems ─────────────────────────────────────────────────────────── */

export function hardProblems(problems: WorkflowProblem[]): WorkflowProblem[] {
  return problems.filter((p) => p.severity === 'error');
}

/** Cheap local checks for instant feedback (the engine's lint is the authority). */
export function quickLint(nodes: XrFlowNode[], edges: XrFlowEdge[]): WorkflowProblem[] {
  const out: WorkflowProblem[] = [];
  if (nodes.length === 0) {
    out.push({ severity: 'error', code: 'empty', message: 'Add at least one node.' });
    return out;
  }
  const incoming = new Set(edges.map((e) => e.target));
  const outgoing = new Set(edges.map((e) => e.source));
  const names = new Map<string, string>();
  for (const n of nodes) {
    const c = n.data.config;
    const k = n.data.kind;
    if (!n.data.label.trim()) out.push({ severity: 'error', code: 'label', message: 'Node has no name.', nodeId: n.id });
    if (k === 'input') {
      const p = String(c.paramName ?? '').trim();
      if (!p) out.push({ severity: 'error', code: 'input_name', message: `Input “${n.data.label}” needs a parameter name.`, nodeId: n.id });
      else if (names.has(p)) out.push({ severity: 'error', code: 'input_dup', message: `Two inputs share the parameter name “${p}”.`, nodeId: n.id });
      else names.set(p, n.id);
    }
    if (k === 'llm' && !String(c.instruction ?? '').trim()) out.push({ severity: 'error', code: 'llm_instruction', message: `LLM “${n.data.label}” has no instruction.`, nodeId: n.id });
    if (k === 'subagent' && !String(c.agentId ?? '').trim()) out.push({ severity: 'error', code: 'subagent_agent', message: `Sub-agent “${n.data.label}” has no agent picked.`, nodeId: n.id });
    if (k === 'tool' && !String(c.tool ?? '').trim()) out.push({ severity: 'error', code: 'tool_name', message: `Tool “${n.data.label}” has no tool picked.`, nodeId: n.id });
    if ((k === 'human_approval' || k === 'human_review') && !String(c.summary ?? '').trim()) out.push({ severity: 'warning', code: 'human_summary', message: `“${n.data.label}” has no summary; you will be asked to decide without context.`, nodeId: n.id });
    if (k === 'branch' && String(c.conditionType ?? '') !== 'expression' && !String(c.field ?? '').trim()) out.push({ severity: 'error', code: 'branch_field', message: `Branch “${n.data.label}” compares an empty field.`, nodeId: n.id });
    if (k !== 'input' && !incoming.has(n.id) && nodes.length > 1) out.push({ severity: 'warning', code: 'no_incoming', message: `“${n.data.label}” has nothing flowing into it.`, nodeId: n.id });
    if (k !== 'output' && k !== 'artifact' && k !== 'notification' && !outgoing.has(n.id) && nodes.length > 1) out.push({ severity: 'warning', code: 'no_outgoing', message: `“${n.data.label}” leads nowhere.`, nodeId: n.id });
  }
  return out;
}

/* ── Clipboard ────────────────────────────────────────────────────────── */

export interface ClipboardPayload {
  nodes: XrFlowNode[];
  edges: XrFlowEdge[];
}

export function cloneForPaste(payload: ClipboardPayload, offset = 32): ClipboardPayload {
  const idMap = new Map<string, string>();
  const nodes = payload.nodes.map((n) => {
    const id = newNodeId(n.data.kind);
    idMap.set(n.id, id);
    return { ...n, id, selected: true, position: { x: n.position.x + offset, y: n.position.y + offset }, data: { ...n.data, config: { ...n.data.config } } };
  });
  const edges = payload.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ ...e, id: edgeId(idMap.get(e.source)!, idMap.get(e.target)!, e.sourceHandle), source: idMap.get(e.source)!, target: idMap.get(e.target)!, selected: false }));
  return { nodes, edges };
}

/* ── Starter graph ────────────────────────────────────────────────────── */

/** A new workflow starts with the smallest useful shape: Input → LLM → Approval → Output. */
export function starterGraph(): { nodes: XrFlowNode[]; edges: XrFlowEdge[] } {
  const input = makeNode('input', { x: 80, y: 92 }, { label: 'Topic', config: { ...defaultConfig('input'), paramName: 'topic', required: true, description: 'What to write about' } });
  const llm = makeNode('llm', { x: 380, y: 80 }, { label: 'Draft', config: { ...defaultConfig('llm'), instruction: 'Write a short, factual note about {{topic}}. Three sentences.', maxUsd: 0.25 } });
  const approval = makeNode('human_approval', { x: 680, y: 80 }, { label: 'Check draft', config: { ...defaultConfig('human_approval'), summary: 'Read the draft before it is published.', riskLevel: 'low' } });
  const output = makeNode('output', { x: 980, y: 92 }, { label: 'Done', config: { ...defaultConfig('output'), message: 'Draft approved.' } });
  const nodes = [input, llm, approval, output];
  const edges: XrFlowEdge[] = [
    { id: edgeId(input.id, llm.id), source: input.id, target: llm.id, sourceHandle: 'out', targetHandle: 'in', type: 'xr' },
    { id: edgeId(llm.id, approval.id), source: llm.id, target: approval.id, sourceHandle: 'out', targetHandle: 'in', type: 'xr' },
    { id: edgeId(approval.id, output.id), source: approval.id, target: output.id, sourceHandle: 'out', targetHandle: 'in', type: 'xr' },
  ];
  return { nodes, edges };
}

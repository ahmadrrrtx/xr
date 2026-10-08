/*
 * Workflow editor store (Phase 19) — one document, one run.
 *
 *   document  nodes/edges (React Flow shapes), selection, clipboard,
 *             undo/redo, dirty, definitionId + version
 *   problems  engine lint (`POST /workflows/inspect`, debounced) with a
 *             cheap local pass for instant feedback; hard errors block Save
 *   run       the ACTIVE run's progress folded from the engine's SSE
 *             stream (replay + live). Nothing here advances a node; the
 *             engine does, and approvals are engine-enforced — this store
 *             only posts decisions and renders what comes back.
 *
 * Saving compiles the canvas on the engine (canvas → canonical
 * WorkflowDefinition → lint → versioned publish). The client never writes
 * a definition itself.
 */
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from '@xyflow/react';
import { toast } from 'sonner';
import { create } from 'zustand';

import {
  controlRun,
  createWorkflow,
  decideHuman,
  deleteWorkflow,
  describeEngineError,
  getRun,
  getWorkflow,
  inspectGraph,
  listRuns,
  listWorkflows,
  startWorkflowRun,
  streamRun,
  updateWorkflow,
  type CanvasNodeKind,
  type GraphSummary,
  type HumanDecision,
  type RunListItem,
  type WorkflowParameter,
  type WorkflowProblem,
  type WorkflowRunEvent,
  type WorkflowRunView,
  type WorkflowSummary,
} from '@/agents/api';
import {
  canConnect,
  cloneForPaste,
  edgeId,
  graphCounts,
  hardProblems,
  layerLayout,
  makeNode,
  parametersOf,
  quickLint,
  starterGraph,
  toFlow,
  toGraph,
  type ClipboardPayload,
  type XrFlowEdge,
  type XrFlowNode,
  type XrNodeData,
} from '@/agents/canvasCore';
import { applyRunEvent, emptyProgress, isActive, isTerminal, mergeView, progressFromView, type RunProgress } from '@/agents/reduce';
import type { EngineRunRecorder } from '@/brain/engine';
import { settleEngineApproval } from '@/engine/approvals';
import { EngineDown, EngineHttpError } from '@/engine/transport';
import type { StreamEvent } from '@/lib/llm';
import { useSettingsStore } from '@/stores/settingsStore';

interface Snapshot {
  nodes: XrFlowNode[];
  edges: XrFlowEdge[];
}

export interface RunDialogState {
  open: boolean;
  parameters: WorkflowParameter[];
  values: Record<string, string>;
}

interface WorkflowEditorState {
  // library
  definitions: WorkflowSummary[];
  definitionsLoading: boolean;
  definitionsError: string | null;
  engineDown: boolean;

  // document
  definitionId: string | null;
  version: number | null;
  versions: number[];
  name: string;
  description: string;
  tags: string[];
  nodes: XrFlowNode[];
  edges: XrFlowEdge[];
  selectedNodeId: string | null;
  clipboard: ClipboardPayload | null;
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
  saving: boolean;
  loadingDoc: boolean;
  docError: string | null;

  // problems
  problems: WorkflowProblem[];
  problemsSource: 'engine' | 'local';
  inspecting: boolean;
  summary: GraphSummary | null;
  problemsOpen: boolean;
  inspectorOpen: boolean;

  // run
  progress: RunProgress | null;
  starting: boolean;
  runError: string | null;
  runDialog: RunDialogState;
  lastParameters: Record<string, unknown>;
  history: RunListItem[];
  historyOpen: boolean;
  deciding: string | null;
  announce: { n: number; text: string } | null;

  // library actions
  loadDefinitions: () => Promise<void>;
  newWorkflow: () => void;
  open: (definitionId: string, version?: number) => Promise<void>;
  closeDocument: () => boolean;
  remove: () => Promise<void>;
  duplicate: () => Promise<void>;
  exportJson: () => Promise<void>;

  // document actions
  setName: (name: string) => void;
  setDescription: (d: string) => void;
  onNodesChange: (changes: NodeChange<XrFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<XrFlowEdge>[]) => void;
  onConnect: (c: Connection) => void;
  beginDrag: () => void;
  endDrag: () => void;
  addNode: (kind: CanvasNodeKind, position: { x: number; y: number }) => string;
  updateNode: (id: string, patch: Partial<XrNodeData>) => void;
  updateNodeConfig: (id: string, patch: Record<string, unknown>) => void;
  selectNode: (id: string | null) => void;
  selectAll: () => void;
  deleteSelection: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  duplicateSelection: () => void;
  nudge: (dx: number, dy: number) => void;
  undo: () => void;
  redo: () => void;
  autoArrange: () => void;
  setInspectorOpen: (open: boolean) => void;
  setProblemsOpen: (open: boolean) => void;
  inspectNow: () => Promise<void>;
  save: () => Promise<boolean>;

  // run actions
  requestRun: () => Promise<void>;
  setRunValue: (name: string, value: string) => void;
  closeRunDialog: () => void;
  startRun: (parameters: Record<string, unknown>) => Promise<void>;
  attachRun: (runId: string) => Promise<void>;
  cancelRun: () => Promise<void>;
  pauseRun: () => Promise<void>;
  resumeRun: () => Promise<void>;
  decide: (nodeId: string, decision: HumanDecision, comment?: string) => Promise<void>;
  clearRun: () => void;
  rerun: () => Promise<void>;
  saveAsTemplate: () => Promise<void>;
  loadHistory: () => Promise<void>;
  setHistoryOpen: (open: boolean) => void;
  leaveScreen: () => void;
}

const MAX_HISTORY = 60;
const INSPECT_DEBOUNCE_MS = 450;
const EDIT_COALESCE_MS = 900;

let streamCtl: AbortController | null = null;
let inspectTimer: number | null = null;
let announceSeq = 0;
let lastEditKey = '';
let lastEditAt = 0;
let dragSnapshot: Snapshot | null = null;
let recorder: EngineRunRecorder | null = null;
let recordedUsd = 0;
let recorderOpen = new Set<string>();

function snap(s: { nodes: XrFlowNode[]; edges: XrFlowEdge[] }): Snapshot {
  return { nodes: s.nodes, edges: s.edges };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
}

function say(text: string): { announce: { n: number; text: string } } {
  announceSeq += 1;
  return { announce: { n: announceSeq, text } };
}

/* ── Brain / Runs mirror ──────────────────────────────────────────────── */

async function beginRecorder(run: WorkflowRunView, stop: () => void): Promise<void> {
  try {
    const { useBrainStore } = await import('@/stores/brainStore');
    recordedUsd = run.cost?.actualUsd ?? 0;
    recorderOpen = new Set();
    recorder = useBrainStore.getState().beginEngineRun(
      run.runId,
      {
        title: `Workflow · ${run.name}`.slice(0, 72),
        agent: 'Workflow',
        model: 'per node',
        startedAt: run.startedAt ?? run.createdAt ?? Date.now(),
        sessionId: null,
        prompt: Object.keys(run.resolvedParameters ?? {}).length ? JSON.stringify(run.resolvedParameters).slice(0, 2000) : undefined,
        mode: 'workflow',
        quiet: true,
      },
      { stop },
    );
    recorder.feed({ type: 'run', runId: run.runId });
  } catch {
    recorder = null;
  }
}

function mirror(e: WorkflowRunEvent, labelOf: (id: string) => string, pendingApproval: (nodeId: string) => string | null): void {
  const rec = recorder;
  if (!rec || rec.ended()) return;
  const feed = (ev: StreamEvent): void => rec.feed(ev);
  switch (e.type) {
    case 'run_state':
      feed({ type: 'status', status: e.state, message: `workflow ${e.state.replace(/_/g, ' ')}` });
      return;
    case 'node_state': {
      const label = labelOf(e.nodeId);
      if (e.state === 'running' && !recorderOpen.has(e.nodeId)) {
        recorderOpen.add(e.nodeId);
        feed({ type: 'tool_call', call: { id: e.nodeId, tool: label, summary: e.kind.replace(/_/g, ' '), category: 'tool', status: 'running', startedAt: e.at } });
        return;
      }
      if (e.state === 'waiting_approval' || e.state === 'waiting_review') {
        if (!recorderOpen.has(e.nodeId)) {
          recorderOpen.add(e.nodeId);
          feed({ type: 'tool_call', call: { id: e.nodeId, tool: label, summary: e.kind.replace(/_/g, ' '), category: 'approval', status: 'waiting-approval', startedAt: e.at } });
        }
        feed({ type: 'tool_waiting', id: e.nodeId, approvalId: pendingApproval(e.nodeId) ?? e.nodeId });
        return;
      }
      if (e.state === 'completed' || e.state === 'failed' || e.state === 'cancelled' || e.state === 'skipped' || e.state === 'expired') {
        if (!recorderOpen.has(e.nodeId)) {
          if (e.state === 'skipped') return; // never ran — nothing to close
          recorderOpen.add(e.nodeId);
          feed({ type: 'tool_call', call: { id: e.nodeId, tool: label, summary: e.kind.replace(/_/g, ' '), category: 'tool', status: 'running', startedAt: e.at } });
        }
        const output = e.error ?? (e.outputs ? JSON.stringify(e.outputs).slice(0, 2000) : e.state);
        feed({ type: 'tool_result', id: e.nodeId, output, status: e.state === 'completed' ? 'done' : 'error', ...(e.state === 'cancelled' ? { denied: true } : {}) });
      }
      return;
    }
    case 'log':
      feed({ type: 'status', status: 'log', message: e.line });
      return;
    case 'cost_update': {
      const delta = (e.cost.actualUsd ?? 0) - recordedUsd;
      if (delta > 0) {
        recordedUsd = e.cost.actualUsd;
        feed({ type: 'budget_charged', costUsd: delta, model: 'workflow' });
      }
      return;
    }
    case 'run_end': {
      const st = e.summary.state;
      if (st === 'failed' && e.summary.error) feed({ type: 'error', message: e.summary.error });
      feed({ type: 'done', stopped: st === 'completed' ? 'done' : st === 'cancelled' ? 'cancelled' : st === 'failed' ? 'error' : 'done' });
      return;
    }
    default:
      return;
  }
}

async function settleSpend(p: RunProgress): Promise<void> {
  const usd = p.cost?.actualUsd ?? 0;
  if (usd <= 0) return;
  try {
    const { recordSpend } = await import('@/budget/enforce');
    await recordSpend({
      kind: 'llm_call',
      agent: 'workflow',
      workspace: null,
      sessionId: null,
      model: null,
      tokensIn: p.cost?.tokensIn ?? 0,
      tokensOut: p.cost?.tokensOut ?? 0,
      costUsd: usd,
      category: 'llm',
      detail: { surface: 'workflows', engine: true, runId: p.runId, measured: true },
    });
  } catch {
    /* the engine metered the run itself; the local ledger is best-effort */
  }
}

/* ── Store ────────────────────────────────────────────────────────────── */

export const useWorkflowEditorStore = create<WorkflowEditorState>((set, get) => {
  const pushHistory = (before: Snapshot): void => {
    const past = [...get().past, before].slice(-MAX_HISTORY);
    set({ past, future: [] });
  };

  const scheduleInspect = (): void => {
    if (inspectTimer !== null) window.clearTimeout(inspectTimer);
    inspectTimer = window.setTimeout(() => {
      inspectTimer = null;
      void get().inspectNow();
    }, INSPECT_DEBOUNCE_MS);
  };

  /** Structural change: history + dirty + lint. */
  const mutate = (fn: (s: Snapshot) => Partial<Snapshot>, opts: { history?: boolean; editKey?: string } = { history: true }): void => {
    const cur = snap(get());
    const next = fn(cur);
    if (opts.history !== false) {
      const now = Date.now();
      const coalesce = opts.editKey && opts.editKey === lastEditKey && now - lastEditAt < EDIT_COALESCE_MS;
      if (!coalesce) pushHistory(cur);
      lastEditKey = opts.editKey ?? '';
      lastEditAt = now;
    }
    set({ ...next, dirty: true });
    scheduleInspect();
  };

  const labelOf = (id: string): string => get().nodes.find((n) => n.id === id)?.data.label ?? id;
  const pendingApproval = (nodeId: string): string | null => get().progress?.pendingHuman.find((h) => h.nodeId === nodeId)?.approvalId ?? null;

  const onEvent = (e: WorkflowRunEvent): void => {
    const p = get().progress;
    if (!p || ('runId' in e && e.runId !== p.runId)) return;
    const next = applyRunEvent(p, e);
    const patch: Partial<WorkflowEditorState> = { progress: next };
    if (e.type === 'node_state') {
      const label = labelOf(e.nodeId);
      // The same human check also sits in the Shield queue (synced from the
      // engine). Once the node leaves its waiting state the engine has
      // recorded a decision — settle the local copy with that outcome.
      const settled = e.state !== 'waiting_approval' && e.state !== 'waiting_review' ? pendingApproval(e.nodeId) : null;
      if (settled) {
        const expired = e.state === 'expired';
        void settleEngineApproval(
          settled,
          e.state === 'completed',
          expired ? 'Expired before anyone decided' : e.state === 'cancelled' ? 'Withdrawn — the run was cancelled' : `Decided on the workflow canvas (${label})`,
          expired ? 'auto-timeout' : 'user',
        );
      }
      if (e.state === 'running') Object.assign(patch, say(`${label} started`));
      else if (e.state === 'completed') Object.assign(patch, say(`${label} completed`));
      else if (e.state === 'failed') Object.assign(patch, say(`${label} failed${e.error ? `: ${e.error}` : ''}`));
      else if (e.state === 'waiting_approval' || e.state === 'waiting_review') Object.assign(patch, say(`${label} is waiting for your decision`));
    } else if (e.type === 'run_end') {
      Object.assign(patch, say(`Workflow ${next.state.replace(/_/g, ' ')}`));
    }
    set(patch);
    mirror(e, labelOf, pendingApproval);
    if (e.type === 'run_end') {
      void settleSpend(next);
      void get().loadDefinitions();
    }
  };

  return {
    definitions: [],
    definitionsLoading: false,
    definitionsError: null,
    engineDown: false,

    definitionId: null,
    version: null,
    versions: [],
    name: '',
    description: '',
    tags: [],
    nodes: [],
    edges: [],
    selectedNodeId: null,
    clipboard: null,
    past: [],
    future: [],
    dirty: false,
    saving: false,
    loadingDoc: false,
    docError: null,

    problems: [],
    problemsSource: 'local',
    inspecting: false,
    summary: null,
    problemsOpen: false,
    inspectorOpen: true,

    progress: null,
    starting: false,
    runError: null,
    runDialog: { open: false, parameters: [], values: {} },
    lastParameters: {},
    history: [],
    historyOpen: false,
    deciding: null,
    announce: null,

    /* ── library ───────────────────────────────────────────────────── */

    loadDefinitions: async () => {
      if (get().definitionsLoading) return;
      set({ definitionsLoading: true, definitionsError: null });
      try {
        const definitions = await listWorkflows();
        set({ definitions, definitionsLoading: false, engineDown: false });
      } catch (e) {
        const down = e instanceof EngineDown;
        set({ definitionsLoading: false, engineDown: down, definitionsError: down ? 'The engine is not reachable. Workflows live in it; nothing is cached.' : describeEngineError(e).message });
      }
    },

    newWorkflow: () => {
      if (!get().closeDocument()) return;
      const g = starterGraph();
      set({
        definitionId: null,
        version: null,
        versions: [],
        name: 'Untitled workflow',
        description: '',
        tags: [],
        nodes: g.nodes,
        edges: g.edges,
        selectedNodeId: null,
        past: [],
        future: [],
        dirty: true,
        docError: null,
        problems: quickLint(g.nodes, g.edges),
        problemsSource: 'local',
        summary: null,
        progress: null,
        runError: null,
        history: [],
        ...say('New workflow: Input, LLM, Approval, Output.'),
      });
      useSettingsStore.getState().update('agents', { lastWorkflowId: null });
      scheduleInspect();
    },

    open: async (definitionId, version) => {
      if (get().definitionId !== definitionId && !get().closeDocument()) return;
      set({ loadingDoc: true, docError: null });
      try {
        const doc = await getWorkflow(definitionId, version);
        const g = toFlow(doc.graph);
        set({
          definitionId: doc.workflow.definitionId,
          version: doc.workflow.version,
          versions: doc.versions,
          name: doc.workflow.name,
          description: doc.workflow.description ?? '',
          tags: doc.workflow.tags,
          nodes: g.nodes,
          edges: g.edges,
          selectedNodeId: null,
          past: [],
          future: [],
          dirty: false,
          loadingDoc: false,
          problems: doc.problems,
          problemsSource: 'engine',
          summary: graphCounts(g.nodes),
          progress: null,
          runError: null,
          history: [],
          ...say(`Opened ${doc.workflow.name}, version ${doc.workflow.version}.`),
        });
        useSettingsStore.getState().update('agents', { lastWorkflowId: definitionId });
        // A run started before a reload is still the engine's; pick it back up.
        try {
          const runs = await listRuns({ definitionId });
          const live = runs.find((r) => isActive(r.state));
          if (live && get().definitionId === definitionId) await get().attachRun(live.runId);
        } catch {
          /* history is optional */
        }
      } catch (e) {
        set({ loadingDoc: false, docError: e instanceof EngineDown ? 'The engine is not reachable.' : describeEngineError(e).message });
      }
    },

    closeDocument: () => {
      const s = get();
      if (s.dirty && s.nodes.length && !window.confirm('Discard unsaved changes to this workflow?')) return false;
      streamCtl?.abort();
      streamCtl = null;
      set({ definitionId: null, version: null, versions: [], name: '', description: '', tags: [], nodes: [], edges: [], selectedNodeId: null, past: [], future: [], dirty: false, problems: [], summary: null, progress: null, runError: null, history: [], docError: null });
      return true;
    },

    remove: async () => {
      const id = get().definitionId;
      if (!id) {
        get().closeDocument();
        return;
      }
      try {
        await deleteWorkflow(id);
        set({ dirty: false });
        get().closeDocument();
        useSettingsStore.getState().update('agents', { lastWorkflowId: null });
        toast('Workflow deleted');
        await get().loadDefinitions();
      } catch (e) {
        toast.error(describeEngineError(e).message);
      }
    },

    duplicate: async () => {
      const s = get();
      if (!s.nodes.length) return;
      try {
        const doc = await createWorkflow({ name: `${s.name || 'Untitled workflow'} (copy)`, description: s.description, graph: toGraph(s.nodes, s.edges), tags: s.tags });
        toast(`Duplicated as ${doc.workflow.name}`);
        await get().loadDefinitions();
        await get().open(doc.workflow.definitionId);
      } catch (e) {
        const d = describeEngineError(e);
        toast.error(d.problems.length ? 'Fix the problems before duplicating.' : d.message);
      }
    },

    exportJson: async () => {
      const s = get();
      const payload = {
        schemaVersion: 'xr-5.0.0/wf-canvas-v1',
        name: s.name,
        description: s.description,
        tags: s.tags,
        ...(s.definitionId ? { definitionId: s.definitionId, version: s.version } : {}),
        graph: toGraph(s.nodes, s.edges),
      };
      const text = `${JSON.stringify(payload, null, 2)}\n`;
      const file = `xr-workflow-${slug(s.name)}.json`;
      try {
        const { isTauri } = await import('@/lib/tauri');
        if (isTauri()) {
          const { save } = await import('@tauri-apps/plugin-dialog');
          const path = await save({ defaultPath: file, filters: [{ name: 'XR workflow', extensions: ['json'] }] });
          if (!path) return;
          const { writeTextFile } = await import('@tauri-apps/plugin-fs');
          await writeTextFile(path, text);
          toast(`Exported ${file}`);
          return;
        }
      } catch {
        /* browser download below */
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    /* ── document ──────────────────────────────────────────────────── */

    setName: (name) => set({ name, dirty: true }),
    setDescription: (description) => set({ description, dirty: true }),

    onNodesChange: (changes) => {
      const structural = changes.some((c) => c.type === 'position' || c.type === 'remove' || c.type === 'add');
      const nodes = applyNodeChanges(changes, get().nodes);
      const sel = changes.find((c) => c.type === 'select');
      const patch: Partial<WorkflowEditorState> = { nodes };
      if (structural) patch.dirty = true;
      if (sel) {
        const selected = nodes.filter((n) => n.selected);
        patch.selectedNodeId = selected.length === 1 ? selected[0].id : selected.length === 0 ? null : get().selectedNodeId;
      }
      set(patch);
      if (changes.some((c) => c.type === 'remove')) scheduleInspect();
    },

    onEdgesChange: (changes) => {
      const edges = applyEdgeChanges(changes, get().edges);
      const structural = changes.some((c) => c.type === 'remove' || c.type === 'add');
      set({ edges, ...(structural ? { dirty: true } : {}) });
      if (structural) scheduleInspect();
    },

    onConnect: (c) => {
      if (!c.source || !c.target) return;
      const s = get();
      if (!canConnect(s.nodes, s.edges, { source: c.source, target: c.target, sourceHandle: c.sourceHandle })) return;
      mutate((cur) => ({
        edges: addEdge(
          { id: edgeId(c.source, c.target, c.sourceHandle), source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? 'out', targetHandle: c.targetHandle ?? 'in', type: 'xr' },
          cur.edges,
        ),
      }));
    },

    beginDrag: () => {
      dragSnapshot = snap(get());
    },
    endDrag: () => {
      if (!dragSnapshot) return;
      const before = dragSnapshot;
      dragSnapshot = null;
      const moved = get().nodes.some((n) => {
        const b = before.nodes.find((x) => x.id === n.id);
        return b && (b.position.x !== n.position.x || b.position.y !== n.position.y);
      });
      if (moved) {
        pushHistory(before);
        set({ dirty: true });
      }
    },

    addNode: (kind, position) => {
      const node = makeNode(kind, position);
      mutate((cur) => ({ nodes: [...cur.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] }));
      set({ selectedNodeId: node.id, inspectorOpen: true, ...say(`Added ${node.data.label}`) });
      return node.id;
    },

    updateNode: (id, patch) => {
      mutate(
        (cur) => ({ nodes: cur.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) }),
        { history: true, editKey: `node:${id}:${Object.keys(patch).join(',')}` },
      );
    },

    updateNodeConfig: (id, patch) => {
      mutate(
        (cur) => ({ nodes: cur.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n)) }),
        { history: true, editKey: `config:${id}:${Object.keys(patch).join(',')}` },
      );
    },

    selectNode: (id) =>
      set((s) => ({
        selectedNodeId: id,
        nodes: s.nodes.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })),
        edges: s.edges.some((e) => e.selected) ? s.edges.map((e) => ({ ...e, selected: false })) : s.edges,
        ...(id ? { inspectorOpen: true } : {}),
      })),

    selectAll: () => set((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })), edges: s.edges.map((e) => ({ ...e, selected: true })) })),

    deleteSelection: () => {
      const s = get();
      const nodeIds = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id));
      const edgeIds = new Set(s.edges.filter((e) => e.selected).map((e) => e.id));
      if (nodeIds.size === 0 && edgeIds.size === 0) return;
      mutate((cur) => ({
        nodes: cur.nodes.filter((n) => !nodeIds.has(n.id)),
        edges: cur.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)),
      }));
      set({ selectedNodeId: null });
      const what = nodeIds.size ? `${nodeIds.size} ${nodeIds.size === 1 ? 'node' : 'nodes'}` : `${edgeIds.size} ${edgeIds.size === 1 ? 'connection' : 'connections'}`;
      toast(`Deleted ${what}`, { action: { label: 'Undo', onClick: () => get().undo() } });
    },

    copy: () => {
      const s = get();
      const nodes = s.nodes.filter((n) => n.selected);
      if (!nodes.length) return;
      const ids = new Set(nodes.map((n) => n.id));
      set({ clipboard: { nodes, edges: s.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) } });
    },

    cut: () => {
      get().copy();
      get().deleteSelection();
    },

    paste: () => {
      const clip = get().clipboard;
      if (!clip) return;
      const pasted = cloneForPaste(clip);
      mutate((cur) => ({ nodes: [...cur.nodes.map((n) => ({ ...n, selected: false })), ...pasted.nodes], edges: [...cur.edges, ...pasted.edges] }));
      set({ selectedNodeId: pasted.nodes.length === 1 ? pasted.nodes[0].id : null, ...say(`Pasted ${pasted.nodes.length} ${pasted.nodes.length === 1 ? 'node' : 'nodes'}`) });
    },

    duplicateSelection: () => {
      const s = get();
      const nodes = s.nodes.filter((n) => n.selected);
      if (!nodes.length) return;
      const ids = new Set(nodes.map((n) => n.id));
      const pasted = cloneForPaste({ nodes, edges: s.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) });
      mutate((cur) => ({ nodes: [...cur.nodes.map((n) => ({ ...n, selected: false })), ...pasted.nodes], edges: [...cur.edges, ...pasted.edges] }));
      set({ selectedNodeId: pasted.nodes.length === 1 ? pasted.nodes[0].id : null });
    },

    nudge: (dx, dy) => {
      if (!get().nodes.some((n) => n.selected)) return;
      mutate(
        (cur) => ({ nodes: cur.nodes.map((n) => (n.selected ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)) }),
        { history: true, editKey: 'nudge' },
      );
    },

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({ nodes: prev.nodes, edges: prev.edges, past: s.past.slice(0, -1), future: [snap(s), ...s.future].slice(0, MAX_HISTORY), dirty: true, selectedNodeId: null });
      scheduleInspect();
    },

    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({ nodes: next.nodes, edges: next.edges, future: s.future.slice(1), past: [...s.past, snap(s)].slice(-MAX_HISTORY), dirty: true, selectedNodeId: null });
      scheduleInspect();
    },

    autoArrange: () => {
      mutate((cur) => ({ nodes: layerLayout(cur.nodes, cur.edges) }));
      set(say('Arranged nodes left to right.'));
    },

    setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
    setProblemsOpen: (problemsOpen) => set({ problemsOpen }),

    inspectNow: async () => {
      const s = get();
      if (!s.nodes.length) {
        set({ problems: quickLint(s.nodes, s.edges), problemsSource: 'local', summary: null });
        return;
      }
      const local = quickLint(s.nodes, s.edges);
      set({ inspecting: true, summary: graphCounts(s.nodes) });
      try {
        const res = await inspectGraph(toGraph(s.nodes, s.edges));
        // The engine lint is the authority; keep local-only hints that the
        // engine does not phrase (empty names etc.) so nothing silently drops.
        const engineCodes = new Set(res.problems.map((p) => `${p.nodeId ?? ''}:${p.code}`));
        const extra = local.filter((p) => p.severity === 'warning' && !engineCodes.has(`${p.nodeId ?? ''}:${p.code}`) && !res.problems.some((q) => q.nodeId === p.nodeId && q.severity === 'error'));
        set({ problems: [...res.problems, ...extra], problemsSource: 'engine', inspecting: false, summary: res.summary, engineDown: false });
      } catch (e) {
        set({ problems: local, problemsSource: 'local', inspecting: false, engineDown: e instanceof EngineDown });
      }
    },

    save: async () => {
      const s = get();
      if (s.saving) return false;
      const local = quickLint(s.nodes, s.edges);
      const hard = hardProblems(local);
      if (hard.length) {
        set({ problems: s.problemsSource === 'engine' ? [...hardProblems(s.problems), ...local.filter((p) => !s.problems.some((q) => q.code === p.code && q.nodeId === p.nodeId))] : local, problemsOpen: true, ...say(`${hard.length} ${hard.length === 1 ? 'problem blocks' : 'problems block'} saving.`) });
        return false;
      }
      set({ saving: true });
      const name = s.name.trim() || 'Untitled workflow';
      const input = { name, description: s.description.trim() || undefined, graph: toGraph(s.nodes, s.edges), tags: s.tags };
      try {
        const doc = s.definitionId && s.version ? await updateWorkflow(s.definitionId, { ...input, baseVersion: s.version }) : await createWorkflow(input);
        set({
          saving: false,
          dirty: false,
          name: doc.workflow.name,
          definitionId: doc.workflow.definitionId,
          version: doc.workflow.version,
          versions: doc.versions,
          problems: doc.problems,
          problemsSource: 'engine',
          summary: graphCounts(get().nodes),
          ...say(`Saved version ${doc.workflow.version}.`),
        });
        useSettingsStore.getState().update('agents', { lastWorkflowId: doc.workflow.definitionId });
        toast(`Saved · v${doc.workflow.version}`);
        void get().loadDefinitions();
        return true;
      } catch (e) {
        const d = describeEngineError(e);
        if (e instanceof EngineHttpError && e.status === 422 && d.problems.length) {
          set({ saving: false, problems: d.problems.map((p) => ({ severity: 'error' as const, code: 'engine', message: p.message, ...(p.path ? { nodeId: p.path } : {}) })), problemsSource: 'engine', problemsOpen: true });
          return false;
        }
        if (e instanceof EngineHttpError && e.status === 409) {
          set({ saving: false });
          toast.error('A newer version was saved elsewhere. Reopen the workflow to continue.');
          return false;
        }
        set({ saving: false });
        toast.error(d.message);
        return false;
      }
    },

    /* ── run ───────────────────────────────────────────────────────── */

    requestRun: async () => {
      const s = get();
      if (s.progress && isActive(s.progress.state)) return;
      if (s.dirty || !s.definitionId) {
        const ok = await get().save();
        if (!ok) return;
      }
      const parameters = parametersOf(get().nodes);
      if (parameters.length === 0) {
        await get().startRun({});
        return;
      }
      const values: Record<string, string> = {};
      for (const p of parameters) {
        const prev = get().lastParameters[p.name];
        values[p.name] = prev !== undefined ? String(prev) : p.defaultValue !== undefined ? String(p.defaultValue) : '';
      }
      set({ runDialog: { open: true, parameters, values } });
    },

    setRunValue: (name, value) => set((s) => ({ runDialog: { ...s.runDialog, values: { ...s.runDialog.values, [name]: value } } })),
    closeRunDialog: () => set((s) => ({ runDialog: { ...s.runDialog, open: false } })),

    startRun: async (parameters) => {
      const s = get();
      if (!s.definitionId || s.starting) return;
      set({ starting: true, runError: null, runDialog: { ...s.runDialog, open: false } });
      try {
        const run = await startWorkflowRun(s.definitionId, { version: s.version ?? undefined, parameters });
        set({ starting: false, lastParameters: parameters, progress: progressFromView(run), problemsOpen: false, ...say(`Run started: ${run.name}.`) });
        await beginRecorder(run, () => void get().cancelRun());
        void get().attachRun(run.runId);
      } catch (e) {
        const d = describeEngineError(e);
        const msg = e instanceof EngineHttpError && e.status === 429 ? 'Three workflows are already running. Wait for one to finish.' : d.message;
        set({ starting: false, runError: msg });
        toast.error(msg);
      }
    },

    attachRun: async (runId) => {
      streamCtl?.abort();
      const ctl = new AbortController();
      streamCtl = ctl;
      if (get().progress?.runId !== runId) {
        set({ progress: emptyProgress(runId), runError: null });
        try {
          const view = await getRun(runId);
          if (ctl.signal.aborted) return;
          set({ progress: progressFromView(view) });
          if (!recorder || recorder.ended()) await beginRecorder(view, () => void get().cancelRun());
        } catch {
          /* the stream replay fills the gaps */
        }
      }
      try {
        await streamRun(runId, onEvent, ctl.signal);
      } catch (e) {
        if (ctl.signal.aborted) return;
        set({ runError: e instanceof EngineDown ? 'Lost the engine mid-run. The run continues in the engine; reopen to re-attach.' : describeEngineError(e).message });
        return;
      }
      if (ctl.signal.aborted) return;
      // Stream closed: make sure the final state is the engine's, not ours.
      const p = get().progress;
      if (p && p.runId === runId && !isTerminal(p.state)) {
        try {
          const view = await getRun(runId);
          set({ progress: mergeView(p, view) });
        } catch {
          /* leave what we have */
        }
      }
    },

    cancelRun: async () => {
      const p = get().progress;
      if (!p) return;
      try {
        const r = await controlRun(p.runId, 'cancel');
        set((s) => (s.progress ? { progress: { ...s.progress, state: r.state }, ...say('Stopping the run.') } : {}));
        recorder?.finish('killed', 'Stopped by the user');
      } catch (e) {
        toast.error(describeEngineError(e).message);
      }
    },

    pauseRun: async () => {
      const p = get().progress;
      if (!p) return;
      try {
        const r = await controlRun(p.runId, 'pause');
        set((s) => (s.progress ? { progress: { ...s.progress, state: r.state } } : {}));
      } catch (e) {
        toast.error(describeEngineError(e).message);
      }
    },

    resumeRun: async () => {
      const p = get().progress;
      if (!p) return;
      try {
        const r = await controlRun(p.runId, 'resume');
        set((s) => (s.progress ? { progress: { ...s.progress, state: r.state } } : {}));
      } catch (e) {
        toast.error(describeEngineError(e).message);
      }
    },

    decide: async (nodeId, decision, comment) => {
      const p = get().progress;
      if (!p || get().deciding) return;
      set({ deciding: nodeId });
      try {
        const view = await decideHuman(p.runId, { nodeId, decision, ...(comment ? { comment } : {}) });
        set((s) => (s.progress && s.progress.runId === view.runId ? { progress: mergeView(s.progress, view), deciding: null } : { deciding: null }));
      } catch (e) {
        set({ deciding: null });
        const gone = e instanceof EngineHttpError && (e.status === 404 || e.status === 409);
        toast.error(gone ? 'That decision was already made elsewhere.' : describeEngineError(e).message);
      }
    },

    clearRun: () => {
      streamCtl?.abort();
      streamCtl = null;
      set({ progress: null, runError: null });
    },

    rerun: async () => {
      const params = get().lastParameters;
      get().clearRun();
      await get().startRun(params);
    },

    saveAsTemplate: async () => {
      const s = get();
      try {
        const doc = await createWorkflow({ name: `${s.name || 'Untitled workflow'} (template)`, description: s.description, graph: toGraph(s.nodes, s.edges), tags: [...new Set([...s.tags, 'template'])] });
        toast(`Saved template ${doc.workflow.name}`);
        void get().loadDefinitions();
      } catch (e) {
        toast.error(describeEngineError(e).message);
      }
    },

    loadHistory: async () => {
      const id = get().definitionId;
      if (!id) return;
      try {
        set({ history: await listRuns({ definitionId: id }) });
      } catch {
        set({ history: [] });
      }
    },

    setHistoryOpen: (historyOpen) => {
      set({ historyOpen });
      if (historyOpen) void get().loadHistory();
    },

    leaveScreen: () => {
      // The run belongs to the engine. While it is still going we keep
      // listening (Brain spans, Budget settle and the completion summary
      // depend on the tail of the stream); an idle document just stops.
      if (!isActive(get().progress?.state ?? null)) {
        streamCtl?.abort();
        streamCtl = null;
      }
      if (inspectTimer !== null) {
        window.clearTimeout(inspectTimer);
        inspectTimer = null;
      }
    },
  };
});

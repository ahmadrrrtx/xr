/*
 * Research store (Phase 18) — the one store behind the Research screen.
 *
 * It owns the run lifecycle against the EXISTING engine pipeline
 * (`runResearch()` via POST /research/run + its SSE stream): start, stream,
 * cancel, restart, and the cross-surface hooks — Runs/Brain (engine run
 * recorder), Budget (gate before, record after with measured usage), Builder
 * (save-to-workspace through the Shield-gated file/write), Memory (remember).
 *
 * Nothing in here synthesizes, searches or fetches: every source, token and
 * dollar on screen arrives in an engine frame.
 */
import { create } from 'zustand';
import { toast } from 'sonner';

import { EngineDown, EngineHttpError } from '@/engine/transport';
import type { EngineRunRecorder } from '@/brain/engine';
import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';
import { useBrainStore } from '@/stores/brainStore';
import * as api from '@/research/api';
import {
  announcementFor,
  citationIndex,
  engineDepthFor,
  engineModeFor,
  evidenceByStoredSource,
  exportMarkdown,
  followUps,
  isRunningPhase,
  liteFromStored,
  markCited,
  slugify,
  sourceFromLite,
  uiDepthForEngine,
  workspaceReportPath,
  type Budgets,
  type EngineDepth,
  type Phase,
  type RunEvent,
  type Stats,
  type StoredSession,
  type UiDepth,
} from '@/research/core';
import { applyRunEvent, emptyRun, type RunSlice } from '@/research/reduce';

export type SourcesTab = 'all' | 'cited' | 'conflicting';

export interface PdfAttachment {
  id: string;
  name: string;
  bytes: number;
  pages: number;
  chars: number;
  text: string;
  truncated: boolean;
  state: 'uploading' | 'ready' | 'error';
  error?: string;
}

export interface Filters {
  web: boolean;
  arxiv: boolean;
  local: boolean;
  connected: boolean;
}

export interface LocalFilesInfo {
  workspace: string;
  files: number;
  bytes: number;
  skipped: number;
}

export interface ResearchState extends RunSlice {
  query: string;
  depth: UiDepth;
  filters: Filters;
  pdfs: PdfAttachment[];
  jobId: string | null;
  /** The topic the current/last run actually used. */
  runTopic: string;
  runDepth: UiDepth;
  activeSourceId: string | null;
  /** Bumps on every focusCitation so the card can re-flash. */
  focusNonce: number;
  sourcesTab: SourcesTab;
  sourcesCollapsed: boolean;
  logOpen: boolean;
  settings: api.ResearchSettings | null;
  settingsError: string | null;
  recent: api.SessionSummary[];
  /** Viewing a stored session (no live stream). */
  readOnly: boolean;
  localFiles: LocalFilesInfo | null;
  remember: 'idle' | 'saving' | 'saved' | 'duplicate' | 'unavailable';
  saving: boolean;
  announce: { n: number; text: string } | null;
  /** Voice ran this topic on the engine; the screen follows the stored session. */
  voiceFollow: { topic: string; since: number } | null;
  /** Budget governor downshift for this run (explained in the log). */
  downshift: { from: string; to: string; why: string | null } | null;

  // actions
  setQuery: (q: string) => void;
  setDepth: (d: UiDepth) => void;
  setFilter: (k: keyof Filters, v: boolean) => void;
  addPdf: (file: File) => Promise<void>;
  removePdf: (id: string) => void;
  start: (override?: { query?: string }) => Promise<void>;
  cancel: () => Promise<void>;
  restart: () => Promise<void>;
  reset: () => void;
  focusCitation: (sourceId: string) => void;
  setActiveSource: (id: string | null) => void;
  setSourcesTab: (t: SourcesTab) => void;
  toggleSources: (collapsed?: boolean) => void;
  toggleLog: () => void;
  saveToWorkspace: () => Promise<void>;
  exportMd: () => Promise<void>;
  rememberRun: () => Promise<void>;
  loadSettings: () => Promise<void>;
  loadRecent: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  followVoice: (topic: string) => void;
  budgetsFor: () => Record<EngineDepth, Budgets>;
  /**
   * Called when the screen unmounts. A live run keeps streaming into the
   * store (so Runs/Brain stay truthful and coming back shows live state);
   * only the voice-follow pollers stop. Streams close on run end, cancel,
   * reset and window unload.
   */
  leaveScreen: () => void;
}

const PREFS_KEY = 'xr.research.prefs';
const SOURCES_COLLAPSED_KEY = 'xr.research.sources.collapsed';
const DEFAULT_FILTERS: Filters = { web: true, arxiv: false, local: false, connected: false };
const LOCAL_MAX_FILES = 12;
const LOCAL_MAX_BYTES = 200 * 1024;
const RECENT_LIMIT = 10;

let streamAbort: AbortController | null = null;
let recorder: EngineRunRecorder | null = null;
let announceN = 0;
let voiceTimer: number | null = null;
let followTimer: number | null = null;

function describe(e: unknown): string {
  if (e instanceof EngineDown) return e.kind === 'unauthorized' ? 'The engine rejected this session. Re-pair from Settings → Engine.' : 'The engine is not reachable.';
  if (e instanceof EngineHttpError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

function announce(text: string | null): { n: number; text: string } | null {
  if (!text) return null;
  announceN += 1;
  return { n: announceN, text };
}

/** Engine frame → Runs/Brain recorder frames (so research shows in Runs truthfully). */
function recordFrame(rec: EngineRunRecorder, e: RunEvent, slice: RunSlice): void {
  switch (e.type) {
    case 'run_started':
      rec.feed({ type: 'status', status: 'planning', provider: e.provider, model: e.model, message: `research ${e.depth} · web ${e.publicWeb ? 'on' : 'off'} · search ${e.searchAvailable ? 'available' : 'unavailable'}` });
      return;
    case 'status':
      // `generating` opens the recorder's LLM span, which is where the
      // engine's measured usage is credited when the run completes.
      if (e.status === 'synthesizing') rec.feed({ type: 'status', status: 'generating', message: 'synthesizing the report (token usage below covers the whole run: plan, extraction, synthesis)' });
      else rec.feed({ type: 'status', status: e.status, message: `status: ${e.status}` });
      return;
    case 'log':
      rec.feed({ type: 'status', status: slice.engineStatus ?? 'running', message: e.line.trim() });
      return;
    case 'search':
      if (e.phase === 'start') {
        rec.feed({ type: 'tool_call', call: { id: `search:${e.query}`, tool: 'web_search', summary: e.query, category: 'network', input: { query: e.query }, status: 'running' } });
      } else {
        rec.feed({ type: 'tool_result', id: `search:${e.query}`, output: e.unavailableReason ?? `${e.hits ?? 0} hit(s)`, status: e.unavailableReason ? 'error' : 'done' });
      }
      return;
    case 'fetch': {
      const src = slice.sources.find((s) => s.id === e.sourceId);
      if (e.phase === 'start') {
        rec.feed({ type: 'tool_call', call: { id: `fetch:${e.sourceId}`, tool: 'fetch_url', summary: src?.domain ?? e.sourceId, category: 'network', input: { url: src?.url }, status: 'running' } });
      } else {
        rec.feed({ type: 'tool_result', id: `fetch:${e.sourceId}`, output: e.phase === 'ok' ? `${e.chars ?? 0} chars` : (e.error ?? 'failed'), status: e.phase === 'ok' ? 'done' : 'error' });
      }
      return;
    }
    case 'run_completed': {
      const r = e.result;
      if (r.usage.inTokens + r.usage.outTokens > 0) {
        rec.feed({ type: 'status', status: 'generating', message: 'engine usage' }); // no-op if the span is already open
        rec.feed({ type: 'usage', inTokens: r.usage.inTokens, outTokens: r.usage.outTokens });
      }
      const stopped = r.status === 'done' ? 'done' : r.stopReason === 'cancelled' ? 'cancelled' : /budget/i.test(r.stopReason ?? '') ? 'budget' : (r.stopReason ?? 'done');
      rec.feed({ type: 'done', stopped });
      return;
    }
    case 'run_error':
      rec.feed({ type: 'error', message: e.message, code: e.code });
      rec.feed({ type: 'done', stopped: 'error' });
      return;
    default:
      return;
  }
}

/**
 * The workspace Research reads from / writes to: the one open in Builder, else
 * the most recently opened one that still exists. The workspace list hydrates
 * lazily (Workspaces/Builder screens), so load it here when nothing has yet.
 */
async function resolveWorkspace(): Promise<{ ws: { id: string; name: string; path: string } | null; project: { id: string } | null }> {
  const { useBuilderStore } = await import('@/stores/builderStore');
  const { useWorkspaceStore } = await import('@/stores/workspaceStore');
  const b = useBuilderStore.getState();
  if (!useWorkspaceStore.getState().loaded) await useWorkspaceStore.getState().refresh();
  const ws =
    b.workspace ??
    useWorkspaceStore
      .getState()
      .workspaces.filter((w) => w.pathExists)
      .sort((x, y) => (y.lastOpenedAt ?? 0) - (x.lastOpenedAt ?? 0))[0] ??
    null;
  if (!ws) return { ws: null, project: null };
  const project = b.project && b.workspaceId === ws.id ? b.project : null;
  return { ws, project };
}

async function collectLocalFiles(): Promise<{ docs: api.RunDocument[]; info: LocalFilesInfo | null; note: string | null }> {
  const { ws, project: open } = await resolveWorkspace();
  if (!ws) return { docs: [], info: null, note: 'No workspace yet — local files were skipped. Add one in Workspaces to include its .md/.txt notes.' };
  const builder = await import('@/engine/builder');
  const project = open ?? (await builder.openProject(ws.path, ws.name));
  const tree = await builder.fetchTree(project.id);
  const candidates = tree.entries
    .filter((t) => t.type === 'file' && /\.(md|txt)$/i.test(t.name) && !t.rel.includes('node_modules/') && !t.rel.startsWith('research/'))
    .sort((x, y) => (y.mtimeMs ?? 0) - (x.mtimeMs ?? 0));
  const docs: api.RunDocument[] = [];
  let bytes = 0;
  let skipped = 0;
  for (const c of candidates) {
    if (docs.length >= LOCAL_MAX_FILES || bytes + (c.size ?? 0) > LOCAL_MAX_BYTES) {
      skipped += 1;
      continue;
    }
    try {
      const f = await builder.readFile(project.id, c.rel);
      if (!f.isText || !f.content.trim()) continue;
      docs.push({ name: c.rel, text: f.content.slice(0, LOCAL_MAX_BYTES), kind: 'local' });
      bytes += f.content.length;
    } catch {
      skipped += 1;
    }
  }
  return { docs, info: { workspace: ws.name, files: docs.length, bytes, skipped }, note: null };
}

function estimatedTokens(depth: UiDepth): { tokensIn: number; tokensOut: number } {
  // Rough pre-call estimate for the governor (the real usage is recorded after).
  switch (engineDepthFor(depth)) {
    case 'quick':
      return { tokensIn: 12_000, tokensOut: 3_000 };
    case 'thorough':
      return { tokensIn: 60_000, tokensOut: 10_000 };
    default:
      return { tokensIn: 36_000, tokensOut: 6_000 };
  }
}

export const useResearchStore = create<ResearchState>()((set, get) => ({
  ...emptyRun(),
  query: '',
  depth: 'standard',
  filters: { ...DEFAULT_FILTERS },
  pdfs: [],
  jobId: null,
  runTopic: '',
  runDepth: 'standard',
  activeSourceId: null,
  focusNonce: 0,
  sourcesTab: 'all',
  sourcesCollapsed: false,
  logOpen: false,
  settings: null,
  settingsError: null,
  recent: [],
  readOnly: false,
  localFiles: null,
  remember: 'idle',
  saving: false,
  announce: null,
  voiceFollow: null,
  downshift: null,

  setQuery: (query) => set({ query }),
  setDepth: (depth) => {
    if (depth === 'academic') return; // disabled until the papers lane ships
    set({ depth });
    writeSettingJSON(PREFS_KEY, { depth, filters: get().filters });
  },
  setFilter: (k, v) => {
    if (k === 'arxiv' || k === 'connected') return;
    const filters = { ...get().filters, [k]: v };
    set({ filters });
    writeSettingJSON(PREFS_KEY, { depth: get().depth, filters });
  },

  addPdf: async (file) => {
    const id = `pdf_${Math.random().toString(36).slice(2, 10)}`;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast('Only PDF files are supported here');
      return;
    }
    if (file.size > api.PDF_MAX_BYTES) {
      toast('PDF too large (max 20MB)', { description: file.name });
      return;
    }
    set((s) => ({ pdfs: [...s.pdfs, { id, name: file.name, bytes: file.size, pages: 0, chars: 0, text: '', truncated: false, state: 'uploading' }] }));
    try {
      const up = await api.uploadPdf(file);
      set((s) => ({
        pdfs: s.pdfs.map((p) => (p.id === id ? { ...p, pages: up.pages, chars: up.chars, text: up.text, truncated: up.truncated, state: 'ready' } : p)),
      }));
      if (!up.text.trim()) toast('No text found in this PDF', { description: 'Scanned PDFs need OCR, which XR does not run yet.' });
    } catch (e) {
      const msg = e instanceof EngineHttpError && e.status === 413 ? 'PDF too large (max 20MB)' : describe(e);
      set((s) => ({ pdfs: s.pdfs.map((p) => (p.id === id ? { ...p, state: 'error', error: msg } : p)) }));
      toast(msg, { description: file.name });
    }
  },
  removePdf: (id) => set((s) => ({ pdfs: s.pdfs.filter((p) => p.id !== id) })),

  start: async (override) => {
    const st = get();
    const query = (override?.query ?? st.query).trim();
    if (!query) return;
    if (isRunningPhase(st.phase)) return;
    streamAbort?.abort();
    streamAbort = null;
    recorder = null;
    if (followTimer) window.clearInterval(followTimer);
    followTimer = null;

    const depth = st.depth;
    set({
      ...emptyRun(),
      query,
      runTopic: query,
      runDepth: depth,
      jobId: null,
      phase: 'planning',
      readOnly: false,
      activeSourceId: null,
      remember: 'idle',
      localFiles: null,
      voiceFollow: null,
      downshift: null,
      startedAt: Date.now(),
      announce: announce('Planning'),
    });

    // Documents: PDFs already extracted by the engine + workspace notes.
    const documents: api.RunDocument[] = st.pdfs.filter((p) => p.state === 'ready' && p.text.trim()).map((p) => ({ name: p.name, text: p.text, kind: 'pdf' }));
    if (st.filters.local) {
      try {
        const local = await collectLocalFiles();
        documents.push(...local.docs);
        set({ localFiles: local.info });
        if (local.note) toast(local.note);
      } catch (e) {
        toast('Local files were skipped', { description: describe(e) });
      }
    }

    // Budget governor — the same gate every surface uses (fail closed).
    const settings = st.settings ?? (await api.getSettings().catch(() => null));
    let providerOverride: { provider?: string; model?: string } = {};
    try {
      const { budgetGate } = await import('@/budget/enforce');
      const est = estimatedTokens(depth);
      const model = settings?.model || 'unknown';
      const check = await budgetGate({
        model,
        estimatedTokensIn: est.tokensIn,
        estimatedTokensOut: est.tokensOut,
        agent: 'researcher',
        workspace: null,
        sessionId: null,
        surface: 'research',
      });
      if (!check.allowed) {
        set({
          phase: 'error',
          error: { message: check.reason ?? 'Budget limit reached — nothing was sent.', code: 'budget_blocked', egressBlocked: false },
          announce: announce('Research stopped'),
        });
        return;
      }
      if (check.downgradedToModel && check.downgradedToModel !== model) {
        const { resolveEngineModel } = await import('@/engine/wire');
        providerOverride = resolveEngineModel(check.downgradedToModel);
        set((s) => ({
          downshift: { from: model, to: check.downgradedToModel!, why: check.downshiftWhy },
          log: [...s.log, `  ↓ budget governor routed this run to ${check.downgradedToModel}${check.downshiftWhy ? ` — ${check.downshiftWhy}` : ''}`],
        }));
      }
    } catch {
      /* the gate toasts its own failures; fail closed is handled inside budgetGate */
    }

    let started: api.StartRunResponse;
    try {
      started = await api.startRun({
        query,
        depth: engineDepthFor(depth),
        mode: engineModeFor(depth),
        documents: documents.length ? documents : undefined,
        ...providerOverride,
      });
    } catch (e) {
      const msg = e instanceof EngineHttpError && e.status === 429 ? 'Two research runs are already in flight — wait for one to finish.' : describe(e);
      set({ phase: 'error', error: { message: msg, code: e instanceof EngineHttpError ? String(e.status) : 'start_failed', egressBlocked: false }, announce: announce('Research stopped') });
      return;
    }

    const jobId = started.runId;
    set({ jobId, provider: started.provider, model: started.model, searchAvailable: started.searchAvailable, publicWeb: started.publicWeb });

    // Runs / Brain: record the run live through the same recorder Chat uses.
    const rec = useBrainStore.getState().beginEngineRun(
      jobId,
      { title: `Research: ${query.slice(0, 80)}`, agent: 'Researcher', model: started.model, startedAt: Date.now(), mode: `research/${engineDepthFor(depth)}`, prompt: query, quiet: true },
      { stop: () => void get().cancel() },
    );
    rec.feed({ type: 'run', runId: jobId });
    recorder = rec;

    const ac = new AbortController();
    streamAbort = ac;
    const onEvent = (e: RunEvent): void => {
      if (get().jobId !== jobId) return;
      const before = get();
      const next = applyRunEvent(before, e);
      const text = announcementFor(before.phase, next.phase, next.sources.length);
      const patch: Partial<ResearchState> = { ...next };
      if (text) patch.announce = announce(text);
      set(patch);
      if (recorder) recordFrame(recorder, e, next);
      if (e.type === 'run_completed') void settleSpend(e.result.usage, e.result.model, jobId, e.result.sessionId);
      if (e.type === 'run_completed' || e.type === 'run_error') void get().loadRecent();
    };
    try {
      await api.streamRun(jobId, onEvent, ac.signal);
    } catch (e) {
      if (ac.signal.aborted) return;
      const cur = get();
      if (cur.jobId === jobId && isRunningPhase(cur.phase)) {
        set({ phase: 'error', error: { message: `Lost the run stream — ${describe(e)}`, code: 'stream', egressBlocked: false }, announce: announce('Research stopped') });
        recorder?.finish('failed', 'Lost the run stream');
      }
    } finally {
      if (streamAbort === ac) streamAbort = null;
    }
    // The engine closes the stream after stream_end; if it ended without a
    // terminal frame, the run page is the truth.
    const cur = get();
    if (cur.jobId === jobId && isRunningPhase(cur.phase)) {
      set({ phase: 'error', error: { message: 'The run stream ended before the engine reported a result.', code: 'stream_end', egressBlocked: false } });
      recorder?.finish('failed', 'Stream ended early');
    }
  },

  cancel: async () => {
    const { jobId, phase } = get();
    if (!jobId || !isRunningPhase(phase)) return;
    streamAbort?.abort();
    streamAbort = null;
    set({ phase: 'cancelled', endedAt: Date.now(), announce: announce('Cancelled') });
    const res = await api.cancelRun(jobId).catch((e) => ({ ok: false, error: describe(e) }));
    if (!res.ok && res.error) toast('Cancel did not reach the engine', { description: res.error });
    recorder?.finish('killed', 'Stopped by the user');
    recorder = null;
    // Pick up what the engine kept (sources read so far, tokens actually spent).
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => window.setTimeout(r, 500));
      if (get().jobId !== jobId) return;
      try {
        const run = await api.getRun(jobId);
        if (run.result) {
          const cur = get();
          const next = applyRunEvent(cur, { type: 'run_completed', runId: jobId, result: run.result, at: Date.now() });
          set({ ...next, phase: 'cancelled' });
          void settleSpend(run.result.usage, run.result.model, jobId, run.result.sessionId);
          void get().loadRecent();
          return;
        }
      } catch {
        /* keep polling briefly */
      }
    }
  },

  restart: async () => {
    const { runTopic, query, phase } = get();
    if (isRunningPhase(phase)) await get().cancel();
    await get().start({ query: runTopic || query });
  },

  reset: () => {
    streamAbort?.abort();
    streamAbort = null;
    recorder = null;
    set({ ...emptyRun(), jobId: null, readOnly: false, activeSourceId: null, remember: 'idle', localFiles: null, voiceFollow: null, downshift: null });
  },

  focusCitation: (sourceId) => set((s) => ({ activeSourceId: sourceId, focusNonce: s.focusNonce + 1, sourcesCollapsed: false })),
  setActiveSource: (id) => set({ activeSourceId: id }),
  setSourcesTab: (sourcesTab) => set({ sourcesTab }),
  toggleSources: (collapsed) => {
    const next = collapsed ?? !get().sourcesCollapsed;
    set({ sourcesCollapsed: next });
    writeSettingJSON(SOURCES_COLLAPSED_KEY, next);
  },
  toggleLog: () => set((s) => ({ logOpen: !s.logOpen })),

  saveToWorkspace: async () => {
    const st = get();
    if (!st.report || st.saving) return;
    set({ saving: true });
    const md = exportMarkdown({
      topic: st.runTopic,
      report: st.report,
      sources: st.sources,
      index: st.citations,
      stats: st.stats,
      contradictions: st.contradictions,
      generatedAt: st.endedAt ?? Date.now(),
      depth: st.runDepth,
    });
    const rel = workspaceReportPath(st.runTopic, st.endedAt ?? Date.now());
    try {
      const { ws, project: open } = await resolveWorkspace();
      if (ws) {
        const builder = await import('@/engine/builder');
        const project = open ?? (await builder.openProject(ws.path, ws.name));
        const ac = new AbortController();
        const res = await builder.writeFile(project.id, rel, md, null, ac.signal);
        toast('Saved to workspace', { description: `${ws.name}/${res.path}` });
        return;
      }
      // No workspace: a native save dialog (Downloads by default) or a browser download.
      toast('No workspace yet', { description: 'Saving the report as a file instead. Add a workspace to keep research next to your code.' });
      await saveViaDialog(`${slugify(st.runTopic)}-${rel.slice(-13, -3)}.md`, md);
    } catch (e) {
      const builder = await import('@/engine/builder');
      if (e instanceof builder.BuilderDenied) toast('Save declined', { description: e.timedOut ? 'The approval timed out.' : 'The write was not approved.' });
      else toast("Couldn't save the report", { description: describe(e) });
    } finally {
      set({ saving: false });
    }
  },

  exportMd: async () => {
    const st = get();
    if (!st.report) return;
    const md = exportMarkdown({
      topic: st.runTopic,
      report: st.report,
      sources: st.sources,
      index: st.citations,
      stats: st.stats,
      contradictions: st.contradictions,
      generatedAt: st.endedAt ?? Date.now(),
      depth: st.runDepth,
    });
    await saveViaDialog(`${slugify(st.runTopic)}.md`, md);
  },

  rememberRun: async () => {
    const { sessionId, remember } = get();
    if (!sessionId || remember === 'saving') return;
    set({ remember: 'saving' });
    try {
      const r = await api.rememberSession(sessionId);
      if (r.ok) {
        set({ remember: r.duplicate ? 'duplicate' : 'saved' });
        toast(r.duplicate ? 'Already in memory' : 'Saved to memory', { description: r.duplicate ? undefined : `${r.linkedSources} source${r.linkedSources === 1 ? '' : 's'} linked` });
      } else {
        set({ remember: 'unavailable' });
        toast(r.reason === 'memory_disabled' ? 'Memory is off' : "Couldn't save to memory", { description: r.reason === 'memory_disabled' ? 'Turn it on in Memory to keep research findings.' : (r.detail ?? undefined) });
      }
    } catch (e) {
      set({ remember: 'idle' });
      toast("Couldn't save to memory", { description: describe(e) });
    }
  },

  loadSettings: async () => {
    try {
      const [settings, prefs, collapsed] = await Promise.all([
        api.getSettings(),
        readSettingJSON<{ depth?: UiDepth; filters?: Partial<Filters> }>(PREFS_KEY),
        readSettingJSON<boolean>(SOURCES_COLLAPSED_KEY),
      ]);
      set((s) => ({
        settings,
        settingsError: null,
        depth: prefs?.depth && prefs.depth !== 'academic' ? prefs.depth : s.depth,
        filters: { ...s.filters, web: prefs?.filters?.web ?? s.filters.web, local: prefs?.filters?.local ?? s.filters.local },
        sourcesCollapsed: collapsed ?? s.sourcesCollapsed,
      }));
    } catch (e) {
      set({ settingsError: describe(e) });
    }
  },

  loadRecent: async () => {
    try {
      const recent = await api.listSessions();
      set({ recent: recent.slice(0, RECENT_LIMIT) });
    } catch {
      /* the disclosure shows "no past research" */
    }
  },

  loadSession: async (id) => {
    if (isRunningPhase(get().phase)) return;
    try {
      const session = await api.getSession(id);
      set({ ...sliceFromStored(session), jobId: null, readOnly: true, activeSourceId: null, remember: 'idle', voiceFollow: null, downshift: null });
    } catch (e) {
      toast("Couldn't open that research", { description: describe(e) });
    }
  },

  followVoice: (topic) => {
    const since = Date.now();
    set({ query: topic, voiceFollow: { topic, since } });
    if (voiceTimer) window.clearInterval(voiceTimer);
    if (followTimer) window.clearInterval(followTimer);
    const norm = topic.trim().toLowerCase();
    let ticks = 0;
    voiceTimer = window.setInterval(() => {
      ticks += 1;
      if (ticks > 60 || get().voiceFollow?.since !== since) {
        if (voiceTimer) window.clearInterval(voiceTimer);
        voiceTimer = null;
        return;
      }
      void api.listSessions().then((list) => {
        const hit = list.find((r) => r.topic.trim().toLowerCase() === norm && r.updated_at >= since - 15_000);
        if (!hit || get().voiceFollow?.since !== since) return;
        if (voiceTimer) window.clearInterval(voiceTimer);
        voiceTimer = null;
        const poll = async (): Promise<void> => {
          try {
            const session = await api.getSession(hit.id);
            const slice = sliceFromStored(session);
            set({ ...slice, jobId: null, readOnly: true, phase: session.status === 'done' || session.status === 'stopped' ? slice.phase : phaseFor(session.status) });
            if (session.status === 'done' || session.status === 'stopped') {
              if (followTimer) window.clearInterval(followTimer);
              followTimer = null;
              set({ voiceFollow: null });
              void get().loadRecent();
            }
          } catch {
            /* try again on the next tick */
          }
        };
        void poll();
        followTimer = window.setInterval(() => void poll(), 2000);
      });
    }, 2000);
  },

  budgetsFor: () => get().settings?.budgets ?? { quick: { maxQueries: 4, resultsPerQuery: 6, maxSources: 10, maxFetched: 5, maxQuestions: 4, maxEvidencePerSource: 5 }, deep: { maxQueries: 10, resultsPerQuery: 8, maxSources: 28, maxFetched: 16, maxQuestions: 8, maxEvidencePerSource: 8 }, thorough: { maxQueries: 14, resultsPerQuery: 8, maxSources: 40, maxFetched: 24, maxQuestions: 10, maxEvidencePerSource: 8 } },

  leaveScreen: () => {
    if (voiceTimer) window.clearInterval(voiceTimer);
    voiceTimer = null;
    if (followTimer) window.clearInterval(followTimer);
    followTimer = null;
  },
}));

// Window teardown: never leave a reader open past the document.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    streamAbort?.abort();
    streamAbort = null;
  });
}

function phaseFor(status: StoredSession['status']): Phase {
  switch (status) {
    case 'planning':
      return 'planning';
    case 'discovering':
    case 'ranking':
      return 'searching';
    case 'fetching':
    case 'extracting':
    case 'checking':
      return 'reading';
    case 'synthesizing':
      return 'synthesizing';
    default:
      return 'done';
  }
}

/** Stored ResearchSession → run slice (past sessions, voice follow). */
export function sliceFromStored(session: StoredSession): RunSlice & { query: string; runTopic: string; runDepth: UiDepth } {
  const base = emptyRun();
  const evidence = evidenceByStoredSource(session.notes);
  const report = session.finalReport?.trim() || session.synthesis?.report?.trim() || null;
  const citations = citationIndex(report);
  const sources = markCited(
    (session.sources ?? []).map((s, i) => sourceFromLite(liteFromStored(s), i, evidence[s.id] ?? [])),
    citations,
  );
  const fetched = sources.filter((s) => s.status === 'fetched').length;
  const failed = sources.filter((s) => s.status === 'failed').length;
  const startedAt = session.startedAt ?? session.createdAt ?? null;
  const endedAt = session.endedAt ?? session.updatedAt ?? null;
  const terminal = session.status === 'done' || session.status === 'stopped';
  // Stored sessions keep only a human meter string, not structured usage —
  // so no stats object (the UI says "usage was not recorded") rather than zeros.
  const stats: Stats | null = null;
  const phase: Phase = session.status === 'done' ? (fetched === 0 && sources.length === 0 ? 'error' : 'done') : session.status === 'stopped' ? (session.stopReason === 'cancelled' ? 'cancelled' : 'partial') : phaseFor(session.status);
  return {
    ...base,
    query: session.topic,
    runTopic: session.topic,
    runDepth: uiDepthForEngine(session.depth, session.mode),
    phase,
    engineStatus: session.status,
    sessionId: session.id,
    startedAt,
    endedAt,
    sources,
    report,
    shortAnswer: session.synthesis?.shortAnswer ?? null,
    citations,
    contradictions: session.contradictions ?? [],
    openQuestions: session.synthesis?.openQuestions ?? [],
    followUps: followUps(session.synthesis?.openQuestions ?? [], session.topic),
    stats,
    stopReason: session.stopReason ?? null,
    partialReason: phase === 'partial' ? (/budget/i.test(session.stopReason ?? '') ? 'Budget reached — showing partial results' : `Stopped early — ${session.stopReason ?? 'engine stopped'}`) : null,
    error: phase === 'error' ? { message: 'This session finished without any readable sources.', code: 'no_sources', egressBlocked: false } : null,
    progress: { ...base.progress, sourcesDiscovered: sources.length, sourcesFetched: fetched, sourcesFailed: failed, percent: terminal ? 100 : null },
  };
}

/** Record measured spend with the local governor (the engine already metered its own budget). */
async function settleSpend(usage: { inTokens: number; outTokens: number; usd: number | null; local: boolean }, model: string, runId: string, sessionId: string): Promise<void> {
  if (usage.local) return; // local models: $0, nothing to meter
  try {
    const { recordSpend } = await import('@/budget/enforce');
    const { estimateCost } = await import('@/budget/models');
    const cost = usage.usd ?? estimateCost(model, usage.inTokens, usage.outTokens);
    await recordSpend({
      kind: 'llm_call',
      agent: 'researcher',
      workspace: null,
      sessionId,
      model,
      tokensIn: usage.inTokens,
      tokensOut: usage.outTokens,
      costUsd: cost,
      category: 'llm',
      detail: { surface: 'research', engine: true, runId, measured: true, ...(usage.usd == null ? { priceUnknown: true, estimated: true } : {}) },
    });
  } catch {
    /* recordSpend logs in dev; the engine's own meter still applied */
  }
}

async function saveViaDialog(name: string, md: string): Promise<void> {
  try {
    const { isTauri } = await import('@/lib/tauri');
    if (isTauri()) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      let defaultPath = name;
      try {
        const { downloadDir, join } = await import('@tauri-apps/api/path');
        defaultPath = await join(await downloadDir(), name);
      } catch {
        /* dialog opens in its default folder */
      }
      const path = await save({ defaultPath, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!path) return;
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(path, md);
      toast('Exported', { description: path });
      return;
    }
  } catch {
    /* fall back to a download */
  }
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported', { description: name });
}

/*
 * Brain store (Phase 9, brief §3) — one Zustand store for every trace view.
 *
 * Layout decisions:
 *   - Per-run data is keyed by runId (runs/spans/children/expanded/events/
 *     logs) so multiple runs coexist; the route picks which one to show.
 *   - Span records are flat (`data[runId].spans[spanId]`); the tree
 *     component derives its visible row array from `expanded` +
 *     `childrenByParent`. That derived array is what react-window renders —
 *     10k-node runs stay at 60fps because only ~40 rows mount.
 *   - Live streams are module-level (StreamHandle per run); the store only
 *     consumes StreamHooks, so Phase 14's Tauri-backed emitter drops in
 *     with zero store changes.
 *   - Token/cost totals update incrementally: token ticks add deltas, span
 *     end settles the remainder (ticked amounts tracked per span below).
 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  brainRunEnd,
  brainRunStart,
  brainRunStatus,
  brainSpanEnd,
  brainSpanStart,
} from '@/brain/events';
import { fmtTokens } from '@/brain/format';
import {
  buildScript,
  flavorFromId,
  materialize,
  streamMockRun,
  type BudgetHooks,
  type StreamHandle,
} from '@/brain/mock';
import { budgetGate, recordSpend } from '@/budget/enforce';
import { modelInfo } from '@/budget/models';
import {
  createEngineRecorder,
  type EngineRunMeta,
  type EngineRunRecorder,
} from '@/brain/engine';
import { streamChat } from '@/lib/llm';
import {
  type BrainEvent,
  type BrainLogLine,
  type BrainTab,
  type Run,
  type Span,
  type SpanStatus,
} from '@/brain/types';
import type { ApprovalRequest, ApprovalSpec } from '@/lib/approvalCore';
import { isTauri } from '@/lib/tauri';
import { orbSetState } from '@/lib/orb';
import { lookupRunSummary } from '@/runs/registry';
import { useApprovalStore } from '@/stores/approvalStore';

/* ── Module-level (non-serializable) state ────────────────────────────── */

const streams = new Map<string, StreamHandle>();
const ticked = new Map<string, { tokensOut: number; cost: number }>();
const lastTokenEvent = new Map<string, number>();
/** Runs being stopped by a bulk action (Phase 11) — no per-run toast. */
const silentStops = new Set<string>();
/** Phase 14: runs recorded behind another surface (Chat) — that surface
 *  already shows the outcome, so the Brain store doesn't toast for them. */
const quietRuns = new Set<string>();
// Demo ids are `mock-latest-N` and the shortId is N, so start just above the
// seeded history (#…847) — a fresh run reads "#848", not "#1" (Phase 11).
let demoCounter = 847;
let eventId = 0;
let logId = 0;

const EVENT_CAP = 5000;
const LOG_CAP = 8000;

interface RunData {
  spans: Record<string, Span>;
  childrenByParent: Record<string, string[]>;
  expanded: Set<string>;
  events: BrainEvent[];
  logs: BrainLogLine[];
  pendingApprovalSpan: string | null;
  pendingApprovalRequest: string | null;
}

interface BrainState {
  runs: Record<string, Run>;
  /** Newest first (drives the index page's "Recent runs"). */
  runOrder: string[];
  data: Record<string, RunData>;

  selectedSpanId: string | null;
  activeTab: BrainTab;
  followRunning: boolean;
  search: string;
  /** 1 = full run; up to 64. */
  ganttZoom: number;
  /** Visible window start, ms from run start. */
  ganttPanMs: number;
  /** aria-live announcement (counter lets identical texts re-announce). */
  announce: { n: number; text: string } | null;

  loadRun: (id: string) => Promise<void>;
  /** Spawns a fresh demo run and returns its id (navigate to it). */
  /** `flavor: 'short'` → a ~5 s run (chat tool calls, Phase 11). */
  startMockRun: (
    title?: string,
    opts?: { flavor?: 'short' | 'medium' }
  ) => string;
  /**
   * Phase 14: record a real engine stream as a run. The caller owns the
   * stream (Chat tee) and feeds every event to the returned recorder;
   * `control.stop` is what the Brain / Runs Stop button calls.
   */
  beginEngineRun: (
    id: string,
    meta: EngineRunMeta,
    control: { stop: () => void }
  ) => EngineRunRecorder;
  /**
   * Phase 14: Brain "Start a run" — one real agent-mode turn through the
   * engine with the configured model. Returns the run id to navigate to.
   */
  startEngineRun: (prompt: string, opts?: { model: string; title?: string }) => string;
  /** `silent`: the caller (Control Room) announces the outcome itself. */
  stopRun: (id: string, opts?: { silent?: boolean; reason?: string }) => void;
  restartRun: (id: string) => void;
  exportJson: (id: string) => void;

  selectSpan: (spanId: string | null) => void;
  toggleExpanded: (runId: string, spanId: string) => void;
  expandTo: (runId: string, spanId: string) => void;
  setTab: (t: BrainTab) => void;
  toggleFollow: () => void;
  setSearch: (s: string) => void;
  setZoom: (z: number) => void;
  setPan: (ms: number) => void;
  /** Fit the Gantt to the whole run. */
  resetView: () => void;
  forgetRun: (id: string) => void;
}

/* ── Per-run data helpers (store-internal) ────────────────────────────── */

/** Engine ids: `dash_<hex>` (engine-issued) or `eng-<local>` (Brain-started). */
export function isEngineRunId(id: string): boolean {
  return id.startsWith('dash_') || id.startsWith('eng-');
}

function emptyRunData(): RunData {
  return {
    spans: {},
    childrenByParent: {},
    expanded: new Set(),
    events: [],
    logs: [],
    pendingApprovalSpan: null,
    pendingApprovalRequest: null,
  };
}

function pushEvent(d: RunData, ev: Omit<BrainEvent, 'id'>): void {
  eventId += 1;
  d.events = [...d.events, { ...ev, id: eventId }];
  if (d.events.length > EVENT_CAP) d.events = d.events.slice(-EVENT_CAP);
}

function pushLog(
  d: RunData,
  spanId: string | null,
  stream: BrainLogLine['stream'],
  text: string,
  ts?: number
): void {
  logId += 1;
  d.logs = [
    ...d.logs,
    { id: logId, ts: ts ?? Date.now(), spanId, stream, text },
  ];
  if (d.logs.length > LOG_CAP) d.logs = d.logs.slice(-LOG_CAP);
}

/** Immutably patch one span inside a run's data. */
function withSpan(d: RunData, spanId: string, patch: Partial<Span>): RunData {
  const prev = d.spans[spanId];
  if (!prev) return d;
  return { ...d, spans: { ...d.spans, [spanId]: { ...prev, ...patch } } };
}

function withStatus(run: Run, status: SpanStatus, endedAt: number | null): Run {
  return { ...run, status, endedAt };
}

/**
 * Phase 13: every LLM span of a mock run asks the budget governor first and
 * reports its real cost after (budget/enforce.ts). Agents are keyed
 * lowercase so per-agent caps match across chat, Brain and the seed.
 */
const brainBudget: BudgetHooks = {
  gate: (req) =>
    budgetGate({
      model: req.model,
      estimatedTokensIn: req.estimatedTokensIn,
      estimatedTokensOut: req.estimatedTokensOut,
      estimatedCost: req.estimatedCost,
      agent: req.agent.toLowerCase(),
      workspace: req.workspace,
      sessionId: req.sessionId,
      surface: 'brain',
    }),
  record: (i) => {
    void recordSpend({
      kind: 'llm_call',
      agent: i.agent.toLowerCase(),
      workspace: i.workspace,
      sessionId: i.sessionId,
      model: i.model,
      tokensIn: i.tokensIn,
      tokensOut: i.tokensOut,
      costUsd: i.costUsd,
      category: 'llm',
      detail: {
        surface: 'brain',
        route: `/brain/${i.sessionId}`,
        ...(i.partial ? { partial: true } : {}),
      },
    });
  },
};

/* ── Store ────────────────────────────────────────────────────────────── */

export const useBrainStore = create<BrainState>()(
  persist(
    (set, get) => {
      const attachHooks = (
        runId: string,
        handle: StreamHandle | null
      ): void => {
        if (handle) streams.set(runId, handle);
        else streams.delete(runId);
      };

      const announce = (text: string): void => {
        set((st) => ({ announce: { n: (st.announce?.n ?? 0) + 1, text } }));
      };

      const beginRun = (runId: string): void => {
        const st = get();
        const run = st.runs[runId];
        const d = st.data[runId];
        if (!run || !d) return;
        brainRunStart(runId, run);
        pushEvent(d, {
          ts: Date.now(),
          kind: 'run-start',
          spanId: null,
          category: null,
          label: `Run ${run.shortId} started — ${run.title}`,
          detail: `${run.agent} · ${run.model}`,
        });
        pushLog(
          d,
          null,
          'system',
          `run ${run.id} started (agent=${run.agent}, model=${run.model})`
        );
        announce(`Run ${run.shortId} started: ${run.title}`);
        void orbSetState('thinking');
      };

      const endRun = (
        runId: string,
        status: SpanStatus,
        endedAt: number,
        extra?: { errorSummary?: string; killedBy?: 'budget' }
      ): void => {
        const st = get();
        const run = st.runs[runId];
        const d = st.data[runId];
        if (!run || !d) return;
        const durationMs = endedAt - run.startedAt;
        const nextRun: Run = {
          ...withStatus(run, status, endedAt),
          ...(extra?.errorSummary ? { errorSummary: extra.errorSummary } : {}),
          ...(extra?.killedBy ? { killedBy: extra.killedBy } : {}),
        };
        set((s) => ({ runs: { ...s.runs, [runId]: nextRun } }));
        brainRunEnd(runId, status, durationMs, nextRun.costUsd);
        const secs = Math.round(durationMs / 100) / 10;
        pushEvent(d, {
          ts: endedAt,
          kind: 'run-end',
          spanId: null,
          category: null,
          label:
            status === 'completed'
              ? `Run ${run.shortId} completed in ${secs}s`
              : status === 'failed'
                ? `Run ${run.shortId} failed`
                : `Run ${run.shortId} stopped`,
          detail: `${fmtTokens(nextRun.tokensOut)} tokens · $${nextRun.costUsd.toFixed(3)}`,
        });
        pushLog(d, null, 'system', `run ${run.id} ended (${status})`);
        announce(
          status === 'completed'
            ? `Run ${run.shortId} completed.`
            : status === 'failed'
              ? `Run ${run.shortId} failed.`
              : `Run ${run.shortId} stopped.`
        );
        // Cross-surface: the orb leaves its thinking state (Phase 6).
        void orbSetState(status === 'failed' ? 'error' : 'idle');
        // Sonner toast — the visible confirmation (unless a bulk stop from
        // the Control Room already announces it, Phase 11).
        const silent = silentStops.delete(runId) || quietRuns.delete(runId);
        if (!silent) {
          void import('sonner').then(({ toast }) => {
            if (status === 'completed') {
              const cost =
                nextRun.costUsd === 0 && modelInfo(nextRun.model).local
                  ? 'local'
                  : `$${nextRun.costUsd.toFixed(3)}`;
              toast(`Run ${run.shortId} completed in ${secs}s · ${cost}`);
            } else if (status === 'failed') {
              toast(`Run ${run.shortId} failed`, {
                description: 'Open the failed span for the error detail.',
              });
            } else {
              toast(`Run ${run.shortId} stopped`);
            }
          });
        }
        attachHooks(runId, null);
      };

      /** Open the Phase 7 approval modal for a run's approval span. */
      const waitApproval = (
        runId: string,
        spanId: string,
        spec: ApprovalSpec
      ): void => {
        const st = get();
        const d = st.data[runId];
        const run = st.runs[runId];
        if (!d) return;
        // The queue takes a full ApprovalRequest; the stream hands us a spec.
        const req: ApprovalRequest = {
          ...spec,
          id: `brain-appr-${spanId}`,
          createdAt: Date.now(),
        };
        set((s) => ({
          data: {
            ...s.data,
            [runId]: {
              ...d,
              pendingApprovalSpan: spanId,
              pendingApprovalRequest: req.id,
            },
          },
        }));
        pushEvent(d, {
          ts: Date.now(),
          kind: 'approval-wait',
          spanId,
          category: 'approval',
          label: `Waiting for approval — ${spec.action}`,
          detail: spec.resource ?? undefined,
        });
        pushLog(
          d,
          spanId,
          'system',
          `approval requested: ${spec.skillId} · ${spec.action}`
        );
        announce(`Waiting for approval: ${spec.action}`);
        if (run) {
          set((s) => ({
            runs: { ...s.runs, [runId]: withStatus(run, 'waiting', null) },
          }));
          brainRunStatus(runId, 'waiting');
        }
        void useApprovalStore
          .getState()
          .requestApproval(req)
          .then((decision) => {
            const approved = decision.status === 'approved';
            // Granted → the run is live again (denied ends it via the stream).
            const cur = get().runs[runId];
            if (approved && cur && cur.status === 'waiting') {
              set((s) => ({
                runs: { ...s.runs, [runId]: withStatus(cur, 'running', null) },
              }));
              brainRunStatus(runId, 'running');
            }
            const d2 = get().data[runId];
            if (d2) {
              set((s) => ({
                data: {
                  ...s.data,
                  [runId]: {
                    ...d2,
                    pendingApprovalSpan: null,
                    pendingApprovalRequest: null,
                  },
                },
              }));
              pushEvent(d2, {
                ts: Date.now(),
                kind: 'approval-resolved',
                spanId,
                category: 'approval',
                label: approved ? 'Approval granted' : 'Approval denied',
                detail: spec.action,
              });
              announce(approved ? 'Approval granted.' : 'Approval denied.');
            }
            streams.get(runId)?.resolveApproval(approved);
          });
      };

      const hooks = (runId: string) => ({
        onRunStart: (run: Run): void => {
          set((s) => ({ runs: { ...s.runs, [runId]: run } }));
          beginRun(runId);
        },
        onRunStatus: (status: SpanStatus): void => {
          const run = get().runs[runId];
          if (!run || run.endedAt || run.status === status) return;
          set((s) => ({ runs: { ...s.runs, [runId]: withStatus(run, status, null) } }));
          brainRunStatus(runId, status);
          if (status === 'waiting') announce('Waiting for approval.');
        },
        onSpanStart: (span: Span): void => {
          const st = get();
          const d = st.data[runId];
          if (!d) return;
          // Idempotent — preloaded spans (waiting flavour) already exist.
          if (d.spans[span.id]) return;
          let nd: RunData = {
            ...d,
            spans: { ...d.spans, [span.id]: span },
          };
          if (span.parentId) {
            nd = {
              ...nd,
              childrenByParent: {
                ...nd.childrenByParent,
                [span.parentId]: [
                  ...(nd.childrenByParent[span.parentId] ?? []),
                  span.id,
                ],
              },
            };
          }
          set((s) => ({ data: { ...s.data, [runId]: nd } }));
          // tokensIn is known upfront on LLM spans — settle into run totals now.
          if (span.tokensIn) {
            const run = st.runs[runId];
            if (run) {
              set((s) => ({
                runs: {
                  ...s.runs,
                  [runId]: {
                    ...run,
                    tokensIn: run.tokensIn + (span.tokensIn ?? 0),
                  },
                },
              }));
            }
          }
          brainSpanStart(runId, span.id, span.name, span.category);
          pushEvent(nd, {
            ts: span.startedAt,
            kind: 'span-start',
            spanId: span.id,
            category: span.category,
            label: `Start — ${span.name}`,
            detail: span.model,
          });
          if (span.category === 'llm') announce(`Started ${span.name}`);
          // Auto-expand every ancestor of the new node (brief §4c).
          const missing: string[] = [];
          let p = span.parentId;
          while (p && !nd.expanded.has(p)) {
            missing.push(p);
            p = nd.spans[p]?.parentId ?? null;
          }
          if (missing.length) {
            const expanded = new Set(nd.expanded);
            for (const m of missing) expanded.add(m);
            set((s) => ({ data: { ...s.data, [runId]: { ...nd, expanded } } }));
          }
        },
        onSpanEnd: (spanId: string, update: Partial<Span>): void => {
          const st = get();
          const d = st.data[runId];
          const span = d?.spans[spanId];
          if (!d || !span) return;
          const t = ticked.get(spanId) ?? { tokensOut: 0, cost: 0 };
          const finalTokensOut = update.tokensOut ?? span.tokensOut ?? 0;
          const finalCost = update.costUsd ?? span.costUsd ?? 0;
          const remainderTokens = Math.max(0, finalTokensOut - t.tokensOut);
          const remainderCost = Math.max(0, finalCost - t.cost);
          ticked.delete(spanId);

          const endedAt = update.endedAt ?? Date.now();
          const durationMs =
            update.durationMs ?? Math.max(0, endedAt - span.startedAt);
          const status = update.status ?? 'completed';
          const nd = withSpan(d, spanId, {
            ...update,
            durationMs,
            tokensOut: finalTokensOut || undefined,
            costUsd: finalCost || undefined,
            childrenIds: d.childrenByParent[spanId]
              ? [...d.childrenByParent[spanId]]
              : span.childrenIds,
          });
          set((s) => {
            const run = s.runs[runId];
            return {
              data: { ...s.data, [runId]: nd },
              runs:
                run && status !== 'pending'
                  ? {
                      ...s.runs,
                      [runId]: {
                        ...run,
                        tokensOut: run.tokensOut + remainderTokens,
                        costUsd: run.costUsd + remainderCost,
                      },
                    }
                  : s.runs,
            };
          });
          brainSpanEnd(runId, spanId, status, durationMs);
          if (status !== 'pending') {
            pushEvent(nd, {
              ts: endedAt,
              kind: 'span-end',
              spanId,
              category: span.category,
              label: `${status === 'completed' ? 'Done' : status} — ${span.name}`,
              detail: `${Math.round(durationMs)}ms${span.model ? ` · ${span.model}` : ''}`,
            });
            if (status === 'failed') announce(`${span.name} failed`);
          }
        },
        onTokenTick: (
          spanId: string,
          tokensOutDelta: number,
          costDelta: number
        ): void => {
          const st = get();
          const d = st.data[runId];
          const span = d?.spans[spanId];
          if (!d || !span || span.status !== 'running') return;
          const t = ticked.get(spanId) ?? { tokensOut: 0, cost: 0 };
          t.tokensOut += tokensOutDelta;
          t.cost += costDelta;
          ticked.set(spanId, t);
          const nd = withSpan(d, spanId, {
            tokensOut: (span.tokensOut ?? 0) + tokensOutDelta,
            costUsd: (span.costUsd ?? 0) + costDelta,
          });
          const run = st.runs[runId];
          const now = Date.now();
          const last = lastTokenEvent.get(runId) ?? 0;
          const emitEvent = now - last > 1000; // 1s throttle (brief §6)
          if (emitEvent) lastTokenEvent.set(runId, now);
          const tickEvent: BrainEvent = {
            id: ++eventId,
            ts: now,
            kind: 'token-tick',
            spanId,
            category: span.category,
            label: `Tokens — ${span.name}`,
            detail: `+${tokensOutDelta} out · total ${nd.spans[spanId]?.tokensOut ?? 0}`,
          };
          set((s) => ({
            data: {
              ...s.data,
              [runId]: emitEvent
                ? { ...nd, events: [...nd.events, tickEvent].slice(-EVENT_CAP) }
                : nd,
            },
            runs: run
              ? {
                  ...s.runs,
                  [runId]: {
                    ...run,
                    tokensOut: run.tokensOut + tokensOutDelta,
                    costUsd: run.costUsd + costDelta,
                  },
                }
              : s.runs,
          }));
        },
        onApprovalWait: (spanId: string, spec: ApprovalSpec): void => {
          waitApproval(runId, spanId, spec);
        },
        onLog: (
          spanId: string | null,
          stream: BrainLogLine['stream'],
          text: string
        ): void => {
          const d = get().data[runId];
          if (!d) return;
          pushLog(d, spanId, stream, text);
          // pushLog already replaced d.logs immutably — publish the same object.
          set((s) => ({ data: { ...s.data, [runId]: { ...d } } }));
        },
        onRunEnd: ({
          status,
          endedAt,
          errorSummary,
          killedBy,
        }: {
          status: SpanStatus;
          endedAt: number;
          errorSummary?: string;
          killedBy?: 'budget';
        }): void => {
          endRun(runId, status, endedAt, { errorSummary, killedBy });
        },
      });

      /**
       * Seed the Events/Logs tabs from a snapshot so frozen runs aren't empty.
       * (Live runs accumulate these as they stream.)
       */
      const seedHistory = (
        run: Run,
        d: RunData,
        scriptSpans: {
          id: string;
          logs?: {
            at: number;
            stream: 'stdout' | 'stderr' | 'system';
            text: string;
          }[];
        }[]
      ): void => {
        const spanList = Object.values(d.spans).sort(
          (a, b) => a.startedAt - b.startedAt
        );
        const byId = new Map(scriptSpans.map((s) => [s.id, s]));
        for (const sp of spanList) {
          if (sp.status === 'pending') continue;
          pushEvent(d, {
            ts: sp.startedAt,
            kind: 'span-start',
            spanId: sp.id,
            category: sp.category,
            label: `Start — ${sp.name}`,
            detail: sp.model,
          });
          if (sp.endedAt) {
            pushEvent(d, {
              ts: sp.endedAt,
              kind: 'span-end',
              spanId: sp.id,
              category: sp.category,
              label: `${sp.status === 'completed' ? 'Done' : sp.status} — ${sp.name}`,
              detail: `${Math.round(sp.durationMs ?? 0)}ms`,
            });
          }
        }
        for (const sp of spanList) {
          if (sp.status === 'pending') continue;
          for (const l of byId.get(sp.id)?.logs ?? []) {
            pushLog(d, sp.id, l.stream, l.text, sp.startedAt + l.at);
          }
        }
        pushEvent(d, {
          ts: run.startedAt,
          kind: 'run-start',
          spanId: null,
          category: null,
          label: `Run ${run.shortId} — ${run.title}`,
          detail: `${run.agent} · ${run.model}`,
        });
        if (run.endedAt) {
          pushEvent(d, {
            ts: run.endedAt,
            kind: 'run-end',
            spanId: null,
            category: null,
            label: `Run ${run.shortId} ${run.status}`,
            detail: `${fmtTokens(run.tokensOut)} tokens · $${run.costUsd.toFixed(3)}`,
          });
        }
        d.events.sort((a, b) => a.ts - b.ts);
        d.logs.sort((a, b) => a.ts - b.ts);
      };

      return {
        runs: {},
        runOrder: [],
        data: {},

        selectedSpanId: null,
        activeTab: 'trace',
        followRunning: true,
        search: '',
        ganttZoom: 1,
        ganttPanMs: 0,
        announce: null,

        loadRun: async (id) => {
          const st = get();
          if (st.data[id]) return; // already loaded (live or frozen)

          const persisted = st.runs[id];

          // Phase 14: real engine runs are recorded live (beginEngineRun);
          // after a reload only the run record survives. Never rebuild a
          // scripted trace for one — show what is known and say so.
          if (persisted?.source === 'engine' || isEngineRunId(id)) {
            const d = emptyRunData();
            const now = Date.now();
            const run: Run = persisted ?? {
              id,
              shortId: `#${id.replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase()}`,
              title: 'Engine run (not recorded by this window)',
              agent: 'Main',
              model: '—',
              status: 'completed',
              startedAt: now,
              endedAt: now,
              tokensIn: 0,
              tokensOut: 0,
              costUsd: 0,
              rootSpanId: `${id}:root`,
              source: 'engine',
            };
            const rootId = run.rootSpanId;
            d.spans[rootId] = {
              id: rootId,
              parentId: null,
              name: 'agent.run',
              category: 'agent',
              status: run.status === 'running' || run.status === 'waiting' ? 'completed' : run.status,
              startedAt: run.startedAt,
              endedAt: run.endedAt ?? run.startedAt,
              durationMs: (run.endedAt ?? run.startedAt) - run.startedAt,
              tokensIn: run.tokensIn,
              tokensOut: run.tokensOut,
              costUsd: run.costUsd,
              model: run.model,
              metadata: { source: 'engine', detailRetained: false },
            };
            d.expanded = new Set([rootId]);
            pushLog(
              d,
              null,
              'system',
              persisted
                ? 'Span detail for this run was not kept across restarts; totals come from the run record.'
                : 'This window has no trace for this engine run.'
            );
            set((s) => ({
              runs: persisted ? s.runs : { ...s.runs, [id]: run },
              data: { ...s.data, [id]: d },
              runOrder: s.runOrder.includes(id) ? s.runOrder : [id, ...s.runOrder].slice(0, 32),
              selectedSpanId: null,
              search: '',
              ganttZoom: 1,
              ganttPanMs: 0,
            }));
            return;
          }

          // Phase 11: a Control Room row this window never streamed (seeded
          // history or another window's run) — keep ITS metadata, rebuild
          // the trace from the deterministic script for its flavour.
          const summary = persisted ? undefined : lookupRunSummary(id);
          const flavor = flavorFromId(id);
          const script = buildScript(flavor, id);
          const now = Date.now();

          let startedAt: number;
          let asOf: number;
          let live: boolean;
          if (summary) {
            startedAt = summary.startedAt;
            asOf = Number.POSITIVE_INFINITY;
            live = false;
          } else if (persisted) {
            // Reopened after a reload: rebuild the frozen trace from the
            // script (deterministic per id), anchored to its original start.
            // The live stream can't resume, so it settles as complete.
            startedAt = persisted.startedAt;
            asOf = Number.POSITIVE_INFINITY;
            live = false;
          } else if (flavor === 'latest' || id.startsWith('mock-latest-')) {
            // Fresh demo run — streams live from t=0. The id may carry a
            // flavour suffix (`mock-latest-848-short`, Phase 11 chat runs).
            startedAt = now;
            asOf = 0;
            live = true;
          } else if (flavor === 'waiting') {
            const pauseSpan =
              script.spans.find((s) => s.id === script.pauseAt) ??
              script.spans[0];
            startedAt = now - (pauseSpan.start + 3000);
            asOf = pauseSpan.start;
            live = true; // parked at the gate — resumes on the user's decision
          } else {
            // Frozen snapshots sit in the past so elapsed time reads real.
            startedAt =
              now -
              script.totalDuration -
              (8 + (script.spans.length % 50)) * 60_000;
            asOf = Number.POSITIVE_INFINITY;
            live = false;
          }

          const mat = materialize(id, flavor, startedAt, asOf, now);
          const d = emptyRunData();
          d.spans = mat.spans;
          d.childrenByParent = mat.childrenByParent;
          d.expanded = new Set([mat.run.rootSpanId]);

          if (!live) seedHistory(mat.run, d, script.spans);

          const fromSummary: Run | null = summary
            ? {
                ...mat.run,
                shortId: summary.shortId,
                title: summary.title,
                agent: summary.agent,
                workspace: summary.workspace,
                model: summary.model,
                status: summary.status,
                startedAt: summary.startedAt,
                endedAt: summary.endedAt ?? mat.run.endedAt,
                tokensIn: summary.tokensIn,
                tokensOut: summary.tokensOut,
                costUsd: summary.costUsd,
              }
            : null;

          set((s) => ({
            // A persisted run keeps its own metadata (title, cost, status);
            // mat.run is only the deterministic span rebuild.
            runs: persisted
              ? s.runs
              : { ...s.runs, [id]: fromSummary ?? mat.run },
            data: { ...s.data, [id]: d },
            runOrder: s.runOrder.includes(id)
              ? s.runOrder
              : [id, ...s.runOrder].slice(0, 32),
            selectedSpanId: null,
            search: '',
            ganttZoom: 1,
            ganttPanMs: 0,
          }));

          if (live) {
            const handle = streamMockRun(id, hooks(id), {
              startedAt,
              fromPlayhead: asOf,
              budget: brainBudget,
            });
            attachHooks(id, handle);
            if (asOf === 0) beginRun(id);
          }
        },

        beginEngineRun: (id, meta, control) => {
          if (meta.quiet) quietRuns.add(id);
          const d = emptyRunData();
          d.expanded = new Set([`${id}:root`]);
          set((s) => ({
            data: { ...s.data, [id]: d },
            runOrder: [id, ...s.runOrder.filter((x) => x !== id)].slice(0, 32),
          }));
          const h = hooks(id);
          const rec = createEngineRecorder(
            id,
            {
              ...h,
              onRunStart: (run) => h.onRunStart({ ...run, source: 'engine' }),
            },
            meta
          );
          attachHooks(id, {
            resolveApproval: () => {
              /* engine approvals answer through @/engine/approvals */
            },
            stop: () => {
              control.stop();
              rec.finish('killed', 'Stopped by the user');
            },
            isWaitingApproval: () => get().runs[id]?.status === 'waiting',
            isWaitingBudget: () => false,
          });
          return rec;
        },

        startEngineRun: (prompt, opts) => {
          const id = `eng-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          const model = opts?.model ?? get().runs[get().runOrder[0] ?? '']?.model ?? '';
          const controller = new AbortController();
          const rec = get().beginEngineRun(
            id,
            {
              title: opts?.title ?? prompt.slice(0, 72),
              agent: 'Main',
              model,
              startedAt: Date.now(),
              sessionId: id,
              prompt,
              mode: 'agent',
            },
            { stop: () => controller.abort() }
          );
          void streamChat({
            messages: [{ role: 'user', content: prompt }],
            model,
            mode: 'agent',
            sessionId: id,
            maxSteps: 4,
            signal: controller.signal,
            onEvent: (e) => {
              rec.feed(e);
              if (e.type === 'run') {
                const run = get().runs[id];
                if (run) set((s) => ({ runs: { ...s.runs, [id]: { ...run, engineRunId: e.runId } } }));
              }
            },
            budget: { surface: 'brain', sessionId: id, agent: 'main' },
          })
            .catch((err: unknown) => {
              if (controller.signal.aborted) return;
              rec.finish('failed', err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
              if (!rec.ended()) rec.finish(controller.signal.aborted ? 'killed' : 'completed');
            });
          return id;
        },

        startMockRun: (title, opts) => {
          const st = get();
          // `-short` routes flavorFromId to the short script; the shortId is
          // still the trailing digits, so "#12" either way.
          const suffix = opts?.flavor === 'short' ? '-short' : '';
          demoCounter += 1;
          // Skip numbers a persisted run already owns (counter resets on reload).
          let id = `mock-latest-${demoCounter}${suffix}`;
          while (st.runs[id] || st.runs[`mock-latest-${demoCounter}`]) {
            demoCounter += 1;
            id = `mock-latest-${demoCounter}${suffix}`;
          }
          void get().loadRun(id);
          if (title) {
            set((s) => {
              const r = s.runs[id];
              return r ? { runs: { ...s.runs, [id]: { ...r, title } } } : s;
            });
          }
          return id;
        },

        stopRun: (id, opts) => {
          if (opts?.silent) silentStops.add(id);
          const st = get();
          const d = st.data[id];
          // Phase 12: a Shield revoke leaves its reason in the run's log so
          // the trace says why it ended (the Control Room row says the same).
          if (d && opts?.reason) {
            pushLog(d, null, 'system', opts.reason);
            set((s) => ({ data: { ...s.data, [id]: { ...d } } }));
          }
          // Withdraw a parked approval so the Phase 7 modal doesn't leak.
          if (d?.pendingApprovalRequest) {
            useApprovalStore
              .getState()
              .withdraw(
                d.pendingApprovalRequest,
                opts?.reason ?? 'Run stopped'
              );
            set((s) => ({
              data: {
                ...s.data,
                [id]: {
                  ...d,
                  pendingApprovalSpan: null,
                  pendingApprovalRequest: null,
                },
              },
            }));
          }
          streams.get(id)?.stop();
        },

        restartRun: (id) => {
          const cur = get().runs[id];
          if (cur?.source === 'engine' || isEngineRunId(id)) {
            // A real run is not a script: re-run the same prompt as a new run.
            const prompt = (get().data[id]?.spans[`${id}:root`]?.inputs as { prompt?: string } | undefined)?.prompt;
            void import('sonner').then(({ toast }) => {
              if (prompt && cur) {
                const next = get().startEngineRun(prompt, { model: cur.model, title: cur.title });
                toast('Started a new run', { description: `Run ${get().runs[next]?.shortId ?? ''} — the original trace is kept.` });
                window.location.hash = `#/brain/${next}`;
              } else {
                toast('Engine runs restart from where they began', {
                  description: 'Send the message again in Chat; this trace stays as it is.',
                });
              }
            });
            return;
          }
          streams.get(id)?.stop();
          streams.delete(id);
          ticked.clear();
          const st = get();
          if (!st.runs[id]) return;
          const flavor = flavorFromId(id);
          const now = Date.now();
          const fresh = materialize(id, flavor, now, 0, now);
          const d = emptyRunData();
          d.spans = fresh.spans;
          d.childrenByParent = fresh.childrenByParent;
          d.expanded = new Set([fresh.run.rootSpanId]);
          set((s) => ({
            runs: { ...s.runs, [id]: fresh.run },
            data: { ...s.data, [id]: d },
            selectedSpanId: null,
            ganttZoom: 1,
            ganttPanMs: 0,
          }));
          pushEvent(d, {
            ts: now,
            kind: 'run-start',
            spanId: null,
            category: null,
            label: `Run ${fresh.run.shortId} restarted`,
            detail: `${fresh.run.agent} · ${fresh.run.model}`,
          });
          const handle = streamMockRun(id, hooks(id), {
            startedAt: now,
            fromPlayhead: 0,
            budget: brainBudget,
          });
          attachHooks(id, handle);
          beginRun(id);
        },

        exportJson: (id) => {
          const st = get();
          const run = st.runs[id];
          const d = st.data[id];
          if (!run || !d) return;
          const spans = Object.values(d.spans);
          const payload = {
            schema: 'xr.brain.v1',
            exportedAt: new Date().toISOString(),
            run,
            spans,
            events: d.events,
          };
          const filename = `xr-run-${run.id}.json`;
          const text = JSON.stringify(payload, null, 2);
          if (!isTauri()) {
            const blob = new Blob([text], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 4000);
          } else {
            void Promise.all([
              import('@tauri-apps/plugin-dialog'),
              import('@tauri-apps/plugin-fs'),
            ])
              .then(async ([dialog, fs]) => {
                const path = await dialog.save({ defaultPath: filename });
                if (!path) return;
                await fs.writeFile(path, new TextEncoder().encode(text));
              })
              .catch(() => {
                /* dialog cancelled or fs denied — never block on export */
              });
          }
          void import('sonner').then(({ toast }) =>
            toast(`Exported ${filename}`, {
              description: `${spans.length} spans · schema xr.brain.v1`,
            })
          );
        },

        selectSpan: (spanId) => set({ selectedSpanId: spanId }),

        toggleExpanded: (runId, spanId) => {
          const st = get();
          const d = st.data[runId];
          if (!d) return;
          const next = new Set(d.expanded);
          if (next.has(spanId)) next.delete(spanId);
          else next.add(spanId);
          set((s) => ({
            data: { ...s.data, [runId]: { ...d, expanded: next } },
          }));
        },

        expandTo: (runId, spanId) => {
          const st = get();
          const d = st.data[runId];
          if (!d) return;
          const next = new Set(d.expanded);
          let cur = d.spans[spanId];
          while (cur?.parentId) {
            next.add(cur.parentId);
            cur = d.spans[cur.parentId];
          }
          if (next.size !== d.expanded.size) {
            set((s) => ({
              data: { ...s.data, [runId]: { ...d, expanded: next } },
            }));
          }
        },

        setTab: (t) => set({ activeTab: t }),
        toggleFollow: () => set((s) => ({ followRunning: !s.followRunning })),
        setSearch: (s) => set({ search: s }),
        setZoom: (z) => set({ ganttZoom: Math.min(64, Math.max(1, z)) }),
        setPan: (ms) => set({ ganttPanMs: Math.max(0, ms) }),
        resetView: () => set({ ganttZoom: 1, ganttPanMs: 0 }),

        forgetRun: (id) => {
          streams.get(id)?.stop();
          streams.delete(id);
          set((s) => {
            const runs = { ...s.runs };
            delete runs[id];
            const data = { ...s.data };
            delete data[id];
            return { runs, data, runOrder: s.runOrder.filter((r) => r !== id) };
          });
        },
      };
      // ── Persistence: recent runs survive reloads (brief §2). Only the
      //    run list + order is durable; span data re-materializes from the
      //    mock script on open (the live stream can't outlive the session).
      // ──────────────────────────────────────────────────────────────────
    },
    {
      name: 'xr.brain',
      partialize: (s) => ({ runs: s.runs, runOrder: s.runOrder }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as {
          runs?: Record<string, Run>;
          runOrder?: string[];
        };
        const runs = { ...(p.runs ?? {}) };
        // A run still 'running' at page close was interrupted mid-stream —
        // settle it instead of letting the recent list spin forever.
        for (const r of Object.values(runs)) {
          if (r.status === 'running' || r.status === 'waiting') {
            r.status = 'completed';
            r.endedAt = r.endedAt ?? Date.now();
          }
        }
        const runOrder = Array.isArray(p.runOrder)
          ? p.runOrder.filter((id) => runs[id])
          : [];
        // Never reuse a persisted demo-run number or ids would collide.
        const nums = Object.keys(runs)
          .map((id) => Number(id.replace(/\D/g, '')))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length) demoCounter = Math.max(demoCounter, ...nums);
        return { ...current, runs, runOrder };
      },
    }
  )
);

/* ── Derived selectors (used by the screen) ───────────────────────────── */

export function useRun(runId: string | undefined): Run | null {
  return useBrainStore((s) => (runId ? (s.runs[runId] ?? null) : null));
}

/** The span currently running (latest startedAt), or null. */
export function useRunningSpanId(runId: string | undefined): string | null {
  return useBrainStore((s) => {
    if (!runId) return null;
    const d = s.data[runId];
    const run = s.runs[runId];
    if (!d || !run || run.status !== 'running') return null;
    let best: string | null = null;
    let bestAt = -1;
    for (const sp of Object.values(d.spans)) {
      if (sp.status === 'running' && sp.startedAt > bestAt) {
        bestAt = sp.startedAt;
        best = sp.id;
      }
    }
    return best;
  });
}

/* ── Number tween (brief §3: 150ms ease-out; reduced motion = jump) ───── */

export function useTweenNumber(target: number, durationMs = 150): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    if (reduced || durationMs <= 0) {
      fromRef.current = target;
      const raf = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(raf);
    }
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number): void => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduced]);

  return value;
}

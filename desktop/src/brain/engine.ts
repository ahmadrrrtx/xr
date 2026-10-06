/*
 * Engine run → Brain trace (Phase 14).
 *
 * The engine's chat stream is flat (status / token / tool_call / tool_result
 * / usage / done). This module folds it into the span tree the Brain store
 * already renders through `StreamHooks`:
 *
 *   agent.run (root, category agent)
 *   ├─ llm.<provider> · <model>     one per generation step; tokens tick in
 *   ├─ <tool>  (file/shell/network/tool)   tool_call → tool_result
 *   │   └─ approval                 when the engine parks on a human decision
 *   └─ llm.<provider> · <model>     … next step
 *
 * Approvals are NOT re-requested here: `@/engine/approvals` already bridges
 * the engine's `approval_required` to the Phase 7 modal and posts the
 * decision back. The recorder only reflects that wait in the trace.
 *
 * Nothing is scripted. Spans start when the engine says so and end when it
 * reports a result; durations are wall-clock. Token counts come from the
 * provider's `usage` frame — until it arrives the LLM span ticks a rough
 * estimate (chars / 4) so the live counter moves, then settles to the real
 * number (or stays an estimate, flagged in metadata, for providers that
 * report none — Art. IV.5).
 */
import type { StreamEvent } from '@/lib/llm';
import type { Run, Span, SpanCategory, SpanStatus, StreamHooks } from './types';

export interface EngineRunMeta {
  title: string;
  agent: string;
  model: string;
  workspace?: string;
  startedAt: number;
  /** Chat session or Brain-run id — shown in the root span's inputs. */
  sessionId?: string | null;
  prompt?: string;
  mode?: string;
}

export interface EngineRunRecorder {
  /** Feed one stream event (call in order; safe after `finish`). */
  feed: (e: StreamEvent) => void;
  /** The engine's own run id once acknowledged (`run` event). */
  engineRunId: () => string | null;
  /** Force-close everything still open (abort / page unload). */
  finish: (status: SpanStatus, errorSummary?: string) => void;
  /** True once `done`/`error`/`finish` closed the run. */
  ended: () => boolean;
}

export function toolCategory(tool: string): SpanCategory {
  const t = tool.toLowerCase();
  if (/file|dir|glob|grep|read|write|list|delete|move|mkdir/.test(t)) return 'file';
  if (/shell|exec|bash|cmd|process|run_command/.test(t)) return 'shell';
  if (/http|fetch|web|url|search|browser|curl|net/.test(t)) return 'network';
  return 'tool';
}

function shortId(id: string): string {
  // Engine ids look like `run_abc123…` — surface the last 4 chars so the
  // Runs table can refer to it ("#a1f3") without pretending it is a counter.
  const tail = id.replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase();
  return `#${tail || '????'}`;
}

/** Rough live estimate before the provider reports real usage. */
const CHARS_PER_TOKEN = 4;

export function createEngineRecorder(
  runId: string,
  hooks: StreamHooks,
  meta: EngineRunMeta,
): EngineRunRecorder {
  const rootId = `${runId}:root`;
  let seq = 0;
  let engineRunId: string | null = null;
  let ended = false;

  let provider: string | undefined;
  let model = meta.model;

  /** Current generation span (null between steps). */
  let llm: { id: string; text: string; estTokens: number; startedAt: number } | null = null;
  /** Open tool spans by engine tool-call id. */
  const tools = new Map<string, { spanId: string; tool: string; startedAt: number; approvalSpanId?: string }>();
  /** Order-based fallback when the engine's tool_result id does not match. */
  const toolOrder: string[] = [];
  let realUsage: { inTokens: number; outTokens: number } | null = null;
  let fullText = '';
  let lastError: string | null = null;

  const span = (partial: Omit<Span, 'startedAt' | 'endedAt' | 'durationMs' | 'status'> & { startedAt?: number }): Span => ({
    status: 'running',
    startedAt: partial.startedAt ?? Date.now(),
    endedAt: null,
    durationMs: null,
    ...partial,
  });

  const nextId = (kind: string): string => {
    seq += 1;
    return `${runId}:${kind}${seq}`;
  };

  const run: Run = {
    id: runId,
    shortId: shortId(runId),
    title: meta.title,
    agent: meta.agent,
    ...(meta.workspace ? { workspace: meta.workspace } : {}),
    model: meta.model,
    status: 'running',
    startedAt: meta.startedAt,
    endedAt: null,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    rootSpanId: rootId,
  };
  hooks.onRunStart(run);
  hooks.onSpanStart(
    span({
      id: rootId,
      parentId: null,
      name: 'agent.run',
      category: 'agent',
      startedAt: meta.startedAt,
      model: meta.model,
      inputs: {
        ...(meta.prompt ? { prompt: meta.prompt } : {}),
        ...(meta.mode ? { mode: meta.mode } : {}),
        ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
      },
      metadata: { source: 'engine' },
    }),
  );
  hooks.onLog(rootId, 'system', `engine run requested (mode=${meta.mode ?? 'agent'}, model=${meta.model})`);

  const openLlm = (): void => {
    if (llm) return;
    const id = nextId('llm');
    const startedAt = Date.now();
    llm = { id, text: '', estTokens: 0, startedAt };
    hooks.onSpanStart(
      span({
        id,
        parentId: rootId,
        name: provider ? `llm.${provider}.chat` : 'llm.chat',
        category: 'llm',
        startedAt,
        model,
        inputs: { model, ...(provider ? { provider } : {}) },
        metadata: { source: 'engine' },
      }),
    );
  };

  const closeLlm = (status: SpanStatus, extra?: Partial<Span>): void => {
    if (!llm) return;
    const endedAt = Date.now();
    const usage = realUsage;
    const tokensOut = usage ? usage.outTokens : llm.estTokens;
    hooks.onSpanEnd(llm.id, {
      status,
      endedAt,
      durationMs: endedAt - llm.startedAt,
      tokensOut,
      ...(usage ? { tokensIn: usage.inTokens } : {}),
      outputs: llm.text || undefined,
      metadata: { source: 'engine', tokensEstimated: !usage },
      ...extra,
    });
    realUsage = null;
    llm = null;
  };

  const closeTool = (
    key: string | null,
    e: { output?: string; status: 'done' | 'error'; denied?: boolean; blocked?: boolean },
  ): void => {
    const k = key && tools.has(key) ? key : toolOrder.find((id) => tools.has(id)) ?? null;
    if (!k) return;
    const t = tools.get(k)!;
    tools.delete(k);
    const endedAt = Date.now();
    if (t.approvalSpanId) {
      hooks.onSpanEnd(t.approvalSpanId, {
        status: e.denied || e.blocked ? 'failed' : 'completed',
        endedAt,
        durationMs: endedAt - t.startedAt,
        outputs: e.denied ? 'denied' : e.blocked ? 'blocked by policy' : 'approved',
      });
      hooks.onRunStatus?.('running');
    }
    const failed = e.status === 'error' || e.denied || e.blocked;
    hooks.onSpanEnd(t.spanId, {
      status: failed ? 'failed' : 'completed',
      endedAt,
      durationMs: endedAt - t.startedAt,
      outputs: e.output,
      ...(failed
        ? {
            error: {
              name: e.denied ? 'Denied' : e.blocked ? 'Blocked' : 'ToolError',
              message: e.output || (e.denied ? 'Denied by the user' : 'Tool failed'),
            },
          }
        : {}),
    });
    hooks.onLog(t.spanId, failed ? 'stderr' : 'stdout', `${t.tool} ${failed ? 'failed' : 'ok'}${e.output ? `: ${e.output.slice(0, 400)}` : ''}`);
  };

  const end = (status: SpanStatus, extra?: { errorSummary?: string; killedBy?: 'budget' }): void => {
    if (ended) return;
    ended = true;
    const endedAt = Date.now();
    for (const k of [...tools.keys()]) closeTool(k, { status: 'error', output: status === 'killed' ? 'stopped' : 'interrupted' });
    closeLlm(status === 'completed' ? 'completed' : status);
    hooks.onSpanEnd(rootId, {
      status,
      endedAt,
      durationMs: endedAt - meta.startedAt,
      outputs: fullText || undefined,
      ...(extra?.errorSummary ? { error: { name: status === 'killed' ? 'Stopped' : 'Error', message: extra.errorSummary } } : {}),
    });
    hooks.onRunEnd({ status, endedAt, ...extra });
  };

  const feed = (e: StreamEvent): void => {
    if (ended) return;
    switch (e.type) {
      case 'run':
        engineRunId = e.runId;
        hooks.onLog(rootId, 'system', `engine run ${e.runId}`);
        return;
      case 'status': {
        if (e.provider) provider = e.provider;
        if (e.model) model = e.model;
        if (e.status === 'generating') openLlm();
        if (e.status === 'awaiting_approval') hooks.onRunStatus?.('waiting');
        if (e.message) hooks.onLog(llm?.id ?? rootId, 'system', e.message);
        else hooks.onLog(llm?.id ?? rootId, 'system', `status: ${e.status}${e.model ? ` (${e.model})` : ''}`);
        return;
      }
      case 'token': {
        openLlm();
        llm!.text += e.text;
        fullText += e.text;
        const est = Math.floor(llm!.text.length / CHARS_PER_TOKEN);
        const delta = est - llm!.estTokens;
        if (delta > 0) {
          llm!.estTokens = est;
          hooks.onTokenTick(llm!.id, delta, 0);
        }
        return;
      }
      case 'replace':
        fullText = e.text;
        if (llm) llm.text = e.text;
        return;
      case 'usage':
        realUsage = { inTokens: e.inTokens, outTokens: e.outTokens };
        return;
      case 'tool_call': {
        // The step that produced this call is over.
        closeLlm('completed');
        const id = nextId('tool');
        const startedAt = e.call.startedAt ?? Date.now();
        tools.set(e.call.id, { spanId: id, tool: e.call.tool, startedAt });
        toolOrder.push(e.call.id);
        hooks.onSpanStart(
          span({
            id,
            parentId: rootId,
            name: e.call.tool,
            category: toolCategory(e.call.tool),
            startedAt,
            inputs: e.call.input,
            metadata: { source: 'engine', summary: e.call.summary },
          }),
        );
        hooks.onLog(id, 'system', `${e.call.tool} ${e.call.summary}`);
        return;
      }
      case 'tool_waiting': {
        const t = tools.get(e.id);
        if (!t || t.approvalSpanId) return;
        const id = nextId('appr');
        t.approvalSpanId = id;
        hooks.onSpanStart(
          span({
            id,
            parentId: t.spanId,
            name: 'approval',
            category: 'approval',
            inputs: { tool: t.tool, approvalId: e.approvalId },
            metadata: { source: 'engine' },
          }),
        );
        hooks.onLog(id, 'system', `waiting for approval (${e.approvalId})`);
        hooks.onRunStatus?.('waiting');
        return;
      }
      case 'tool_result':
        closeTool(e.id, e);
        return;
      case 'model_switched':
        model = e.to;
        hooks.onLog(rootId, 'system', `budget governor switched ${e.from} → ${e.to}${e.why ? `: ${e.why}` : ''}`);
        return;
      case 'budget_cutoff':
        hooks.onLog(rootId, 'system', `budget cutoff: ${e.reason}`);
        return;
      case 'budget_charged':
        if (e.costUsd > 0) hooks.onTokenTick(llm?.id ?? rootId, 0, e.costUsd);
        return;
      case 'budget_blocked':
        hooks.onLog(rootId, 'stderr', `blocked by the budget governor: ${e.reason}`);
        end('killed', { errorSummary: e.reason, killedBy: 'budget' });
        return;
      case 'error':
        lastError = e.message;
        hooks.onLog(llm?.id ?? rootId, 'stderr', e.message);
        return;
      case 'done': {
        const stopped = e.stopped ?? 'done';
        if (stopped === 'budget') end('killed', { errorSummary: lastError ?? 'Stopped by the budget cap', killedBy: 'budget' });
        else if (stopped === 'cancelled') end('killed', { errorSummary: 'Stopped by the user' });
        else if (stopped === 'error') end('failed', { errorSummary: lastError ?? 'The engine reported an error' });
        else end('completed', stopped === 'max_steps' ? { errorSummary: 'Step limit reached' } : undefined);
        return;
      }
      default:
        return;
    }
  };

  return {
    feed,
    engineRunId: () => engineRunId,
    finish: (status, errorSummary) => end(status, errorSummary ? { errorSummary } : undefined),
    ended: () => ended,
  };
}

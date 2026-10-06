/*
 * Engine chat stream (Phase 14) — `POST /api/v1/chat` → `StreamEvent`s.
 *
 * One request per assistant turn. The engine owns the run (tools, consent,
 * its own per-task cap); this module only
 *   · asks the LOCAL budget governor first (same gate as every surface),
 *     forwards the per-request cap as the engine's hard stop, and records
 *     the real usage afterwards;
 *   · reads the SSE frames the engine actually emits (see engine/types.ts)
 *     and maps them 1:1 onto the desktop's event union — no invented
 *     events, no fake progress;
 *   · decodes envelope-protocol tokens progressively so weak/local models do
 *     not render as a JSON document being typed; `done.fullText` is always
 *     the authoritative text;
 *   · bridges `approval_required` to the desktop's approval queue under the
 *     engine's id and forwards the decision.
 *
 * Cancel = abort the fetch. The engine aborts the run when the client goes
 * away; nothing is emitted after an abort.
 */
import {
  budgetGate,
  cutoffText,
  estimateTokens,
  PRE_CALL_OUT_TOKENS,
  recordSpend,
  startMeter,
  type Meter,
} from '@/budget/enforce';
import { estimateCost } from '@/budget/models';
import type { PreCallCheck } from '@/budget/types';
import type { ToolCallRecord } from '@/lib/chat-db';
import type { ChatTurn, StreamErrorKind, StreamEvent, StreamOptions } from '@/lib/llm';
import { useBudgetStore } from '@/stores/budgetStore';
import { bridgeEngineApproval } from './approvals';
import { EnvelopeDecoder } from './envelope';
import { readSse } from './sse';
import { EngineDown, engineFetch } from './transport';
import type { EngineChatFrame } from './types';
import { describeTool, resolveEngineModel } from './wire';

// Pure mappers live in ./wire.ts (unit-tested without the UI graph).
export { describeTool, resolveEngineModel };

function splitTurns(messages: ChatTurn[]): {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  system: string;
} {
  const system = messages
    .filter((m) => m.role === 'system' && m.content.trim())
    .map((m) => m.content.trim())
    .join('\n\n');
  const chat = messages.filter((m) => m.role !== 'system');
  let lastUser = -1;
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  if (lastUser === -1) {
    return { message: '', history: [], system };
  }
  const history = chat
    .slice(0, lastUser)
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  return { message: chat[lastUser].content, history, system };
}

function errorKindFor(status: number): StreamErrorKind {
  if (status === 503) return 'no_provider';
  if (status === 429) return 'busy';
  if (status === 400 || status === 422) return 'request';
  if (status === 401 || status === 403) return 'auth';
  return 'model';
}

async function readErrorBody(res: Response): Promise<{ message: string; retryable: boolean; code?: string }> {
  let message = `Engine answered ${res.status}`;
  let retryable = res.status === 429 || res.status >= 500;
  let code: string | undefined;
  try {
    const j = (await res.json()) as Record<string, unknown>;
    if (typeof j.error === 'string' && j.error) message = j.error;
    else if (typeof j.message === 'string' && j.message) message = j.message;
    if (typeof j.retryable === 'boolean') retryable = j.retryable;
    if (typeof j.code === 'string') code = j.code;
  } catch {
    /* non-JSON */
  }
  return { message, retryable, code };
}

export async function streamEngineChat(opts: StreamOptions): Promise<void> {
  const { onEvent } = opts;
  // Own controller: user Stop (opts.signal) and the local meter both abort it.
  const controller = new AbortController();
  const emit = (e: StreamEvent): void => {
    if (!controller.signal.aborted || e.type === 'budget_charged') onEvent(e);
  };
  const onOuterAbort = (): void => controller.abort();
  if (opts.signal.aborted) controller.abort();
  else opts.signal.addEventListener('abort', onOuterAbort, { once: true });

  const { message, history, system } = splitTurns(opts.messages);
  if (!message.trim()) {
    emit({ type: 'error', message: 'Nothing to send.', kind: 'request' });
    return;
  }
  const context = [opts.context?.trim(), system].filter(Boolean).join('\n\n');
  const tokensIn = opts.messages.reduce((t, m) => t + estimateTokens(m.content), 0);

  // ── Local budget governor (same gate as every surface) ────────────────
  let check: PreCallCheck | null = null;
  let meter: Meter | null = null;
  let model = opts.model;
  if (opts.budget) {
    check = await budgetGate({
      model,
      estimatedTokensIn: tokensIn,
      estimatedTokensOut: PRE_CALL_OUT_TOKENS,
      agent: opts.budget.agent ?? 'main',
      workspace: opts.budget.workspace ?? null,
      sessionId: opts.budget.sessionId,
      surface: opts.budget.surface,
    });
    if (!check.allowed) {
      emit({ type: 'budget_blocked', code: check.code, reason: check.reason ?? 'Budget limit reached.' });
      return;
    }
    if (check.downgradedToModel) {
      emit({ type: 'model_switched', from: model, to: check.downgradedToModel, why: check.downshiftWhy });
      model = check.downgradedToModel;
    }
    meter = startMeter(check);
  }

  // The engine's own hard stop for this task: the per-request cap, tightened
  // by whatever is left under the hard cap.
  const settings = useBudgetStore.getState().settings;
  const perTaskUsd = opts.budget
    ? Math.max(
        0,
        Math.min(settings.perRequestLimit, check?.hardRemaining ?? Number.POSITIVE_INFINITY),
      )
    : undefined;

  let usage: { inTokens: number; outTokens: number } | null = null;
  let runId: string | null = null;
  let settled = false;
  const settle = (): void => {
    if (settled || !check || !opts.budget) return;
    settled = true;
    const b = opts.budget;
    const c = check;
    const m = meter;
    const inTok = usage?.inTokens ?? tokensIn;
    const outTok = usage?.outTokens ?? m?.tokensOut ?? 0;
    void recordSpend({
      kind: 'llm_call',
      agent: b.agent ?? 'main',
      workspace: b.workspace ?? null,
      sessionId: b.sessionId,
      model: c.model,
      tokensIn: inTok,
      tokensOut: outTok,
      costUsd: estimateCost(c.model, inTok, outTok),
      category: 'llm',
      detail: {
        surface: b.surface,
        engine: true,
        ...(runId ? { runId } : {}),
        ...(usage ? { measured: true } : { estimated: true }),
        ...(m?.cutoff ? { cutoff: true } : {}),
        ...(c.downgradedToModel ? { from: opts.model } : {}),
      },
    }).then((res) => {
      if (res) emit({ type: 'budget_charged', costUsd: res.event.costUsd, model: c.model });
    });
  };

  // ── Request ────────────────────────────────────────────────────────────
  const target = resolveEngineModel(model);
  const body = {
    message,
    history,
    mode: opts.mode ?? 'agent',
    stream: true,
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    ...(target.provider ? { provider: target.provider } : {}),
    ...(target.model ? { model: target.model } : {}),
    ...(perTaskUsd !== undefined && Number.isFinite(perTaskUsd) ? { budget: perTaskUsd } : {}),
    ...(opts.maxSteps ? { maxSteps: opts.maxSteps } : {}),
    ...(context ? { context } : {}),
  };

  let res: Response;
  try {
    res = await engineFetch('/chat', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
  } catch (e) {
    opts.signal.removeEventListener('abort', onOuterAbort);
    if (controller.signal.aborted) return;
    if (e instanceof EngineDown) {
      emit({
        type: 'error',
        kind: e.kind === 'unauthorized' ? 'auth' : 'engine_down',
        message: e.message,
        retryable: true,
      });
      return;
    }
    emit({ type: 'error', kind: 'engine_down', message: 'Engine unreachable', retryable: true });
    return;
  }

  if (!res.ok) {
    opts.signal.removeEventListener('abort', onOuterAbort);
    const err = await readErrorBody(res);
    emit({
      type: 'error',
      kind: errorKindFor(res.status),
      message: err.message,
      retryable: err.retryable,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  // ── Stream ─────────────────────────────────────────────────────────────
  const decoder = new EnvelopeDecoder();
  let shown = ''; // what the UI has been given so far
  const calls = new Map<string, ToolCallRecord>();
  const approvalOutcome = new Map<string, { approved: boolean; blocked: boolean; reason?: string }>();
  const approvalWaits: Promise<unknown>[] = [];
  let finished = false;
  let lastError: { message: string; code?: string; retryable?: boolean } | null = null;
  let budgetStopMessage: string | null = null;
  let maxStepsHit = false;

  const showText = (visible: string): void => {
    if (visible === shown) return;
    if (visible.startsWith(shown)) {
      const delta = visible.slice(shown.length);
      shown = visible;
      if (delta) emit({ type: 'token', text: delta });
    } else {
      shown = visible;
      emit({ type: 'replace', text: visible });
    }
  };

  const onFrame = (payload: string): void => {
    if (payload === '[DONE]') {
      finished = true;
      return;
    }
    let frame: EngineChatFrame;
    try {
      frame = JSON.parse(payload) as EngineChatFrame;
    } catch {
      return; // malformed line — the engine never emits these; skip
    }
    if ('approval_required' in frame && frame.approval_required) {
      const a = frame.approval_required;
      // The loop emits tool_call before it asks; pair by tool name (newest
      // still-running call) so the card shows the pending state.
      const waiting = [...calls.values()].reverse().find((c) => c.tool === a.tool && c.status === 'running');
      if (waiting) {
        waiting.status = 'waiting-approval';
        waiting.approvalId = a.id;
        emit({ type: 'tool_waiting', id: waiting.id, approvalId: a.id });
      }
      emit({ type: 'status', status: 'awaiting_approval', message: `Waiting for your approval: ${a.tool}` });
      approvalWaits.push(
        bridgeEngineApproval(a, controller.signal).then((o) => {
          approvalOutcome.set(a.tool, { approved: o.approved, blocked: o.blocked === true, reason: o.reason });
        }),
      );
      return;
    }
    if (!('type' in frame) || !frame.type) return; // legacy `{text}` lines

    switch (frame.type) {
      case 'status': {
        if (frame.runId && !runId) {
          runId = frame.runId;
          emit({ type: 'run', runId });
        }
        if (frame.status === 'budget_stopped') budgetStopMessage = frame.message ?? 'Stopped at the budget cap.';
        emit({
          type: 'status',
          status: frame.status,
          ...(frame.message ? { message: frame.message } : {}),
          ...(frame.provider ? { provider: frame.provider } : {}),
          ...(frame.model ? { model: frame.model } : {}),
        });
        return;
      }
      case 'token': {
        if (typeof frame.text !== 'string' || !frame.text) return;
        const visible = decoder.push(frame.text);
        showText(visible);
        if (meter && check && !meter.add(estimateTokens(frame.text))) {
          // Local hard cap hit mid-reply: stop the run, keep the partial.
          emit({ type: 'budget_cutoff', reason: cutoffText(check) });
          finished = true;
          controller.abort();
          emit({ type: 'done', stopped: 'budget' });
        }
        return;
      }
      case 'tool_call': {
        const { summary, category } = describeTool(frame.tool, frame.args);
        const call: ToolCallRecord = {
          id: frame.id,
          tool: frame.tool,
          summary,
          category,
          input: frame.args,
          status: 'running',
        };
        calls.set(call.id, call);
        emit({ type: 'tool_call', call });
        return;
      }
      case 'tool_result': {
        const call = calls.get(frame.id);
        const outcome = approvalOutcome.get(frame.tool);
        const denied = !frame.ok && !!call?.approvalId && outcome !== undefined && !outcome.approved;
        const output = frame.ok
          ? (frame.result ?? '')
          : (frame.error ?? frame.result ?? 'Tool failed.');
        if (call) call.status = frame.ok ? 'done' : 'error';
        emit({
          type: 'tool_result',
          id: frame.id,
          output,
          status: frame.ok ? 'done' : 'error',
          ...(denied && outcome?.blocked ? { blocked: true } : {}),
          ...(denied ? { denied: true } : {}),
        });
        if (call?.approvalId) approvalOutcome.delete(frame.tool);
        return;
      }
      case 'usage': {
        // Local runtimes report 0/0 — that is "not measured", not "free of tokens".
        if (frame.usage && ((frame.usage.inTokens ?? 0) > 0 || (frame.usage.outTokens ?? 0) > 0)) {
          usage = { inTokens: frame.usage.inTokens ?? 0, outTokens: frame.usage.outTokens ?? 0 };
          emit({ type: 'usage', ...usage });
        }
        return;
      }
      case 'error': {
        lastError = {
          message: frame.message ?? frame.error ?? 'The model run failed.',
          ...(frame.code ? { code: frame.code } : {}),
          ...(typeof frame.retryable === 'boolean' ? { retryable: frame.retryable } : {}),
        };
        return;
      }
      case 'done': {
        finished = true;
        if (frame.runId && !runId) {
          runId = frame.runId;
          emit({ type: 'run', runId });
        }
        if (frame.usage && ((frame.usage.inTokens ?? 0) > 0 || (frame.usage.outTokens ?? 0) > 0)) {
          usage = { inTokens: frame.usage.inTokens ?? 0, outTokens: frame.usage.outTokens ?? 0 };
          emit({ type: 'usage', ...usage });
        }
        const full = (frame.fullText ?? frame.finalMessage ?? '').trim();
        // The engine's extracted text is authoritative; a different streamed
        // preview (envelope guess, think tags) is replaced, never appended.
        if (full && full !== shown.trim()) showText(full);
        if (frame.stopped === 'max_steps') maxStepsHit = true;
        return;
      }
      default:
        return;
    }
  };

  try {
    await readSse(res, onFrame, controller.signal);
  } catch (e) {
    if (!controller.signal.aborted) {
      opts.signal.removeEventListener('abort', onOuterAbort);
      settle();
      emit({ type: 'error', kind: 'interrupted', message: e instanceof Error ? e.message : 'Stream interrupted.', retryable: true });
      return;
    }
  } finally {
    opts.signal.removeEventListener('abort', onOuterAbort);
  }

  if (controller.signal.aborted) {
    settle(); // tokens already streamed were still spent
    return;
  }

  // Terminal frame → honest outcome. Order matters: budget, model error,
  // then the normal completion.
  if (budgetStopMessage) {
    if (shown.trim()) emit({ type: 'budget_cutoff', reason: budgetStopMessage });
    else emit({ type: 'budget_blocked', code: 'engine-cap', reason: budgetStopMessage });
    emit({ type: 'done', stopped: 'budget' });
    settle();
    return;
  }
  if (lastError && !shown.trim() && calls.size === 0) {
    settle();
    const err: { message: string; code?: string; retryable?: boolean } = lastError;
    emit({
      type: 'error',
      kind: 'model',
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(typeof err.retryable === 'boolean' ? { retryable: err.retryable } : {}),
    });
    return;
  }
  if (!finished) {
    settle();
    emit({ type: 'error', kind: 'interrupted', message: 'The engine closed the stream before the reply finished.', retryable: true });
    return;
  }
  if (lastError) {
    // Partial output exists: keep it, surface the failure as a status note.
    const err: { message: string; code?: string } = lastError;
    emit({ type: 'status', status: 'error', message: err.message });
  }
  if (maxStepsHit) {
    emit({ type: 'status', status: 'done', message: 'Stopped at the step limit for this turn.' });
  }
  emit({ type: 'done', stopped: lastError ? 'error' : 'done' });
  settle();
  // Approval bridges resolve on their own; nothing to await for the UI.
  void Promise.allSettled(approvalWaits);
}

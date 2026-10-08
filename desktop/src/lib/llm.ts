/*
 * The one LLM entry point for every desktop surface (Phase 14).
 *
 *   streamChat(opts) → events          — chat, Workbench, HUD quick-ask, Brain
 *
 * Production path: the XR engine daemon (`@/engine/chat`) — a real HTTP
 * stream, real tools, real approvals, real cost. The Phase 4 mock survives
 * ONLY as a dev seam: Vite dev build + `localStorage['xr.dev.mockLLM'] = '1'`
 * (used by the e2e fixtures that script tool calls deterministically). A
 * production bundle never imports it.
 *
 * The event union is a superset of the mock's: the engine additionally
 * reports `status` (what it is waiting on), `usage` (real token counts),
 * `run` (the engine run id, so a tool card can open its trace) and
 * `replace` (the authoritative final text when the streamed preview — an
 * envelope decode — differs from it). `error` carries a `kind` so surfaces
 * render the honest state (no provider, engine down, auth, busy, …) rather
 * than a generic failure.
 */
import type { SpendSurface } from '@/budget/types';
import type { ApprovalSpec } from '@/lib/approvalCore';
import type { ToolCallRecord } from '@/lib/chat-db';

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type ChatMode = 'agent' | 'ask' | 'plan';

export type StreamErrorKind =
  /** The daemon could not be reached at all. */
  | 'engine_down'
  /** The engine has no usable provider (no key, Ollama not running). */
  | 'no_provider'
  /** The engine rejected the session token. */
  | 'auth'
  /** Lane busy / rate-limited — retry after a moment. */
  | 'busy'
  /** The model/provider failed mid-run (engine `error{code}`). */
  | 'model'
  /** The stream ended without a `done` frame. */
  | 'interrupted'
  /** Bad request (engine 400). */
  | 'request';

export type StreamEvent =
  | { type: 'token'; text: string }
  /** The authoritative text for the turn so far (replaces, never appends). */
  | { type: 'replace'; text: string }
  | { type: 'tool_call'; call: ToolCallRecord }
  | {
      type: 'tool_result';
      id: string;
      output: string;
      status: 'done' | 'error';
      /** XR Shield (desktop policy) answered before the human could. */
      blocked?: boolean;
      /** The human (or the engine's TTL) denied this call. */
      denied?: boolean;
    }
  /** A tool call is parked on an approval (card shows the pending state). */
  | { type: 'tool_waiting'; id: string; approvalId: string }
  /** What the engine is doing right now ("Waiting for qwen2.5:0.5b…"). */
  | { type: 'status'; status: string; message?: string; provider?: string; model?: string }
  /** Real token counts from the provider. */
  | { type: 'usage'; inTokens: number; outTokens: number }
  /** The engine run backing this turn (trace link, Runs row). */
  | { type: 'run'; runId: string }
  | { type: 'done'; stopped?: 'done' | 'error' | 'budget' | 'cancelled' | 'max_steps' | string }
  | {
      type: 'error';
      message: string;
      kind?: StreamErrorKind;
      code?: string;
      retryable?: boolean;
    }
  /** The budget governor (local or engine cap) refused — nothing was sent. */
  | { type: 'budget_blocked'; code: string; reason: string }
  /** The governor routed the turn to a cheaper model. */
  | { type: 'model_switched'; from: string; to: string; why: string | null }
  /** The hard limit hit mid-reply (partial kept). */
  | { type: 'budget_cutoff'; reason: string }
  /** What the turn actually cost (after the stream). */
  | { type: 'budget_charged'; costUsd: number; model: string };

export interface StreamOptions {
  messages: ChatTurn[];
  model: string;
  signal: AbortSignal;
  onEvent: (e: StreamEvent) => void;
  /** Engine execution mode. Default `agent` (tools on, approvals gate them). */
  mode?: ChatMode;
  /** Chat session id — the engine scopes its run/approvals to it. */
  sessionId?: string | null;
  /** Surface context appended to the system prompt (Workbench workspace). */
  context?: string;
  /** Cap on agent steps for this turn (engine default otherwise). */
  maxSteps?: number;
  /**
   * Phase 19: run the turn "as" an agent. The engine narrows its tool set
   * to `toolsAllow` (minus `toolsDeny`) and caps the task at `budgetUsd`;
   * the desktop governor still gates first. Empty allowlist = engine default.
   */
  toolsAllow?: string[];
  toolsDeny?: string[];
  budgetUsd?: number;
  /**
   * Phase 7 contract kept for the mock seam: when a scripted tool needs
   * permission the mock parks on this gate. The engine path ignores it —
   * engine approvals are bridged through `@/engine/approvals` under the
   * engine's own ids.
   */
  requestApproval?: (
    call: { summary: string },
    spec: ApprovalSpec,
  ) => Promise<{ approved: boolean; reason?: string; blocked?: boolean }>;
  /**
   * Who is spending. When set, the local governor is asked before the call
   * (denial → `budget_blocked`), the per-request cap is sent to the engine
   * as its hard stop, and the real usage is recorded afterwards.
   */
  budget?: {
    surface: SpendSurface;
    sessionId: string | null;
    agent?: string;
    workspace?: string | null;
  };
}

export const MOCK_LLM_KEY = 'xr.dev.mockLLM';

/** Dev seam only: never true in a production bundle. */
export function mockLLMEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return window.localStorage.getItem(MOCK_LLM_KEY) === '1';
  } catch {
    return false;
  }
}

export async function streamChat(opts: StreamOptions): Promise<void> {
  if (mockLLMEnabled()) {
    const { streamChat: mock } = await import('@/lib/mockLLM');
    return mock({
      messages: opts.messages,
      model: opts.model,
      signal: opts.signal,
      onEvent: opts.onEvent,
      requestApproval: opts.requestApproval,
      budget: opts.budget,
    });
  }
  const { streamEngineChat } = await import('@/engine/chat');
  return streamEngineChat(opts);
}

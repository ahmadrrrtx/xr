/*
 * Brain — trace data model (Phase 9, brief §1).
 *
 * OTel-flavoured but intentionally small: a run owns a forest of spans in a
 * flat map; the UI derives tree structure from `parentId`. Phase 14 swaps
 * the mock source for real Tauri events behind the same shape.
 */

export type SpanCategory =
  | 'llm'
  | 'tool'
  | 'file'
  | 'network'
  | 'shell'
  | 'approval'
  | 'user'
  | 'agent'
  | 'subagent';

export type SpanStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'waiting';

export interface SpanError {
  name: string;
  message: string;
  stack?: string;
}

export interface Span {
  /** e.g. "sp_847_03" */
  id: string;
  parentId: string | null;
  /** "openai.chat.completions", "fs.readFile", "shell.exec", … */
  name: string;
  category: SpanCategory;
  status: SpanStatus;
  /** ms since epoch */
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
  /** JSON-serialisable args / prompt */
  inputs?: unknown;
  /** JSON-serialisable result / completion */
  outputs?: unknown;
  error?: SpanError;
  metadata?: Record<string, unknown>;
  /** Present once the span is known to have children (drives the chevron). */
  childrenIds?: string[];
}

export interface Run {
  /** e.g. "run_847" */
  id: string;
  /** "#847" */
  shortId: string;
  title: string;
  agent: string;
  workspace?: string;
  model: string;
  status: SpanStatus;
  startedAt: number;
  endedAt: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  rootSpanId: string;
}

/** One entry in the Events / Logs tabs. */
export interface BrainEvent {
  id: number;
  ts: number;
  kind:
    | 'span-start'
    | 'span-end'
    | 'token-tick'
    | 'approval-wait'
    | 'approval-resolved'
    | 'error'
    | 'run-start'
    | 'run-end';
  spanId: string | null;
  category: SpanCategory | null;
  label: string;
  detail?: string;
}

/** One raw log line (Logs tab). */
export interface BrainLogLine {
  id: number;
  ts: number;
  spanId: string | null;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

/** Which canned mock a run id maps to (brief §3). */
export type MockFlavor =
  'short' | 'medium' | 'long' | 'error' | 'waiting' | 'stress' | 'latest';

export type BrainTab = 'trace' | 'timeline' | 'events' | 'cost' | 'logs';

/** Live-stream callback surface — the seam Phase 14's real emitter plugs into. */
export interface StreamHooks {
  onRunStart: (run: Run) => void;
  onSpanStart: (span: Span) => void;
  onSpanEnd: (spanId: string, update: Partial<Span>) => void;
  onTokenTick: (
    spanId: string,
    tokensOutDelta: number,
    costDelta: number
  ) => void;
  /** The run parked at an approval gate; the store must open the Phase 7 modal. */
  onApprovalWait: (
    spanId: string,
    spec: import('@/lib/approvalCore').ApprovalSpec
  ) => void;
  onLog: (
    spanId: string | null,
    stream: BrainLogLine['stream'],
    text: string
  ) => void;
  onRunEnd: (update: { status: SpanStatus; endedAt: number }) => void;
}

export const CATEGORY_LABEL: Record<SpanCategory, string> = {
  llm: 'LLM',
  tool: 'Tool',
  file: 'File',
  network: 'Network',
  shell: 'Shell',
  approval: 'Approval',
  user: 'User',
  agent: 'Agent',
  subagent: 'Subagent',
};

export const STATUS_LABEL: Record<SpanStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  killed: 'Killed',
  waiting: 'Waiting approval',
};

/** CSS var name per category — the single mapping point for spines/bars/dots. */
export const CATEGORY_VAR: Record<SpanCategory, string> = {
  llm: 'var(--cat-llm)',
  tool: 'var(--cat-tool)',
  file: 'var(--cat-file)',
  network: 'var(--cat-network)',
  shell: 'var(--cat-shell)',
  approval: 'var(--cat-approval)',
  user: 'var(--cat-user)',
  agent: 'var(--cat-agent)',
  subagent: 'var(--cat-agent)',
};

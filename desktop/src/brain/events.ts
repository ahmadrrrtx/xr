/*
 * Brain → host cross-window events (Phase 9, brief §10).
 *
 * `brain:run-update` fires on every span start/end and run end so the HUD
 * and Orb windows can later render run state (they listen, they don't yet
 * render). Same seam pattern as lib/orb.ts: Tauri emit in the native shell,
 * dev-build CustomEvent mirror in the browser (the acceptance check runs in
 * devtools — this is what it prints).
 */
import type { Run, Span, SpanStatus } from './types';
import { isTauri } from '@/lib/tauri';

export type BrainUpdate =
  | { kind: 'run-start'; runId: string; run: Run }
  | {
      kind: 'span-start';
      runId: string;
      spanId: string;
      name: string;
      category: Span['category'];
    }
  | {
      kind: 'span-end';
      runId: string;
      spanId: string;
      status: SpanStatus;
      durationMs: number | null;
    }
  | {
      kind: 'run-end';
      runId: string;
      status: SpanStatus;
      durationMs: number | null;
      costUsd: number;
    }
  | {
      /** Phase 11: in-flight status changes (approval gate ↔ running). */
      kind: 'run-status';
      runId: string;
      status: SpanStatus;
    };

function devSeam(payload: BrainUpdate): void {
  if (import.meta.env.DEV) {
    // Devtools-visible mirror of the Tauri emit — the acceptance check
    // watches the console for `brain:run-update` during a run.
    console.debug('[brain] brain:run-update', payload);
    window.dispatchEvent(new CustomEvent('xr-brain-seam', { detail: payload }));
  }
}

export async function emitBrainUpdate(payload: BrainUpdate): Promise<void> {
  devSeam(payload);
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('brain:run-update', payload);
  } catch {
    /* best-effort — never block trace rendering on IPC */
  }
}

/** Small convenience wrappers used by the store. */
export const brainRunStart = (runId: string, run: Run): void =>
  void emitBrainUpdate({ kind: 'run-start', runId, run });

export const brainSpanStart = (
  runId: string,
  spanId: string,
  name: string,
  category: Span['category']
): void =>
  void emitBrainUpdate({ kind: 'span-start', runId, spanId, name, category });

export const brainSpanEnd = (
  runId: string,
  spanId: string,
  status: SpanStatus,
  durationMs: number | null
): void =>
  void emitBrainUpdate({ kind: 'span-end', runId, spanId, status, durationMs });

export const brainRunEnd = (
  runId: string,
  status: SpanStatus,
  durationMs: number | null,
  costUsd: number
): void =>
  void emitBrainUpdate({ kind: 'run-end', runId, status, durationMs, costUsd });

export const brainRunStatus = (runId: string, status: SpanStatus): void =>
  void emitBrainUpdate({ kind: 'run-status', runId, status });

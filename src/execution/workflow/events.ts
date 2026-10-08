/**
 * XR — workflow run events (Phase 19).
 *
 * The engine reports what actually happened to a run as it happens, so a
 * surface (desktop canvas, CLI, Brain trace) can mirror the run without
 * polling and without inventing intermediate states. Every event is derived
 * from a real state transition inside `WorkflowEngine`; nothing is emitted
 * ahead of the transition it describes.
 */
import type {
  WorkflowCost,
  WorkflowNodeKind,
  WorkflowNodeState,
  WorkflowRunState,
  WorkflowRunSummary,
} from "./types.ts";

export type WorkflowRunEvent =
  /** The run-level state changed (queued → running → awaiting_approval …). */
  | { type: "run_state"; runId: string; state: WorkflowRunState; at: number }
  /** A node changed state. `outputs` are included only for terminal states. */
  | {
      type: "node_state";
      runId: string;
      nodeId: string;
      kind: WorkflowNodeKind;
      state: WorkflowNodeState;
      attempt: number;
      error?: string;
      outputs?: Record<string, unknown>;
      at: number;
    }
  /** A progress line from an agentic node (the loop's own observations). */
  | { type: "log"; runId: string; nodeId?: string; line: string; at: number }
  /** Aggregate cost changed (after an agentic node settled). */
  | { type: "cost_update"; runId: string; cost: WorkflowCost; at: number }
  /** A human node is waiting; `approvalId` is the durable approval record. */
  | { type: "approval_required"; runId: string; nodeId: string; approvalId: string | null; kind: "approval" | "review" | "tool"; summary: string; at: number }
  /** The run reached a terminal state. */
  | { type: "run_end"; runId: string; summary: WorkflowRunSummary; at: number };

export type WorkflowEventSink = (event: WorkflowRunEvent) => void;

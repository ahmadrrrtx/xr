/**
 * XR — workflow definition linter (Phase 19).
 *
 * `nodes.ts#validateGraph` already answers the structural questions
 * (duplicate ids, missing dependencies, cycles, triggers at the root). The
 * editor needs more than a boolean: WHICH node has WHAT problem, and whether
 * it blocks publishing. This module adds the per-kind configuration checks
 * and reachability analysis and returns structured problems.
 *
 * Severity contract:
 *   - `error`   → the definition cannot be published or run.
 *   - `warning` → publishable; shown so the author can decide.
 */
import type { WorkflowNode } from "./types.ts";
import { downstreamNodes, entryNodes, validateGraph } from "./nodes.ts";

export type WorkflowProblemSeverity = "error" | "warning";

export interface WorkflowProblem {
  severity: WorkflowProblemSeverity;
  /** Stable machine code (also used by tests). */
  code: string;
  /** Node the problem belongs to; absent for graph-level problems. */
  nodeId?: string;
  message: string;
}

export interface WorkflowLintResult {
  problems: WorkflowProblem[];
  /** True when no `error` problems exist. */
  ok: boolean;
}

const HUMAN_MIN_SUMMARY = 3;

export function lintDefinition(nodes: WorkflowNode[], entryNodeIds?: string[]): WorkflowLintResult {
  const problems: WorkflowProblem[] = [];
  const push = (severity: WorkflowProblemSeverity, code: string, message: string, nodeId?: string): void => {
    problems.push({ severity, code, message, ...(nodeId ? { nodeId } : {}) });
  };

  if (nodes.length === 0) {
    push("error", "empty", "The workflow has no nodes.");
    return { problems, ok: false };
  }

  // ── Structure (delegated) ────────────────────────────────────────────────
  const graph = validateGraph(nodes);
  for (const err of graph.errors) {
    const m = /^Node (\S+) depends on missing node (\S+)/.exec(err);
    const c = /^Cycle detected: (\S+) -> (\S+)/.exec(err);
    const t = /^Trigger node (\S+) should have no dependencies/.exec(err);
    if (m) push("error", "missing_dependency", `Depends on a node that does not exist (${m[2]}).`, m[1]);
    else if (c) push("error", "cycle", `Part of a cycle (${c[1]} → ${c[2]}). Workflows must be acyclic.`, c[1]);
    else if (t) push("error", "trigger_has_dependencies", "An Input node cannot depend on other nodes.", t[1]);
    else push("error", "graph", err);
  }

  // ── Entry / reachability ────────────────────────────────────────────────
  const entries = entryNodes(nodes).map((n) => n.id);
  const declaredEntries = entryNodeIds && entryNodeIds.length ? entryNodeIds : entries;
  if (entries.length === 0) push("error", "no_entry", "No entry node — every node waits on another one.");
  const reachable = new Set<string>([...declaredEntries, ...downstreamNodes(nodes, declaredEntries)]);
  const ids = new Set(nodes.map((n) => n.id));
  const referenced = new Set<string>();
  for (const n of nodes) for (const d of n.dependencies) referenced.add(d);

  for (const n of nodes) {
    if (!reachable.has(n.id)) {
      push("error", "unreachable", `"${n.label}" can never run — nothing leads to it.`, n.id);
    } else if (nodes.length > 1 && n.dependencies.length === 0 && !referenced.has(n.id)) {
      push("warning", "dangling", `"${n.label}" is not connected to anything.`, n.id);
    }
  }

  const hasCompletion = nodes.some((n) => n.kind === "completion");
  if (!hasCompletion) push("warning", "no_completion", "No Output node — the run ends when every node finishes, without a declared result.");

  // ── Per-kind configuration ───────────────────────────────────────────────
  for (const n of nodes) {
    if (!n.label || !n.label.trim()) push("warning", "unnamed", "Node has no name.", n.id);
    switch (n.kind) {
      case "agentic":
        if (!n.instruction || n.instruction.trim().length < 3) push("error", "agentic_no_instruction", `"${n.label}" needs an instruction (what should the agent do?).`, n.id);
        if (!n.agentRole) push("error", "agentic_no_role", `"${n.label}" has no agent role.`, n.id);
        if (n.budget?.maxUsd !== undefined && n.budget.maxUsd <= 0) push("warning", "agentic_zero_budget", `"${n.label}" has a $0 budget — it will stop before the first model call unless the model is local.`, n.id);
        break;
      case "tool_action":
        if (!n.capability?.name) push("error", "tool_no_capability", `"${n.label}" has no tool selected.`, n.id);
        break;
      case "branch": {
        if (n.trueNodes.length === 0 && n.falseNodes.length === 0) push("error", "branch_no_targets", `"${n.label}" has no outgoing paths.`, n.id);
        else if (n.trueNodes.length === 0 || n.falseNodes.length === 0) push("warning", "branch_one_sided", `"${n.label}" only routes the ${n.trueNodes.length ? "true" : "false"} path; the other outcome ends the branch.`, n.id);
        for (const id of [...n.trueNodes, ...n.falseNodes]) if (!ids.has(id)) push("error", "branch_bad_target", `"${n.label}" routes to a node that does not exist (${id}).`, n.id);
        const c = n.condition;
        if ((c.type === "field_compare" || c.type === "field_exists" || c.type === "field_is_empty") && !c.field) push("error", "branch_no_field", `"${n.label}" compares an empty field.`, n.id);
        if (c.type === "expression" && !c.expression.trim()) push("error", "branch_no_expression", `"${n.label}" has an empty expression.`, n.id);
        break;
      }
      case "human_approval":
        if (!n.request.summary || n.request.summary.trim().length < HUMAN_MIN_SUMMARY) push("error", "approval_no_summary", `"${n.label}" needs a request summary — the approver has to know what they are approving.`, n.id);
        if (!n.approver?.kind) push("error", "approval_no_approver", `"${n.label}" has no approver.`, n.id);
        if (n.expiresInMs <= 0) push("warning", "approval_no_expiry", `"${n.label}" never expires.`, n.id);
        break;
      case "human_review":
        if (!n.request.summary || n.request.summary.trim().length < HUMAN_MIN_SUMMARY) push("error", "review_no_summary", `"${n.label}" needs a review summary.`, n.id);
        for (const id of n.request.reviewTargetNodes) if (!ids.has(id)) push("error", "review_bad_target", `"${n.label}" reviews a node that does not exist (${id}).`, n.id);
        break;
      case "wait_timer":
        if (n.timer.type === "delay" && (!Number.isFinite(n.timer.durationMs) || n.timer.durationMs <= 0)) push("error", "wait_no_duration", `"${n.label}" needs a positive duration.`, n.id);
        if (n.timer.type === "event" && !n.timer.eventName) push("error", "wait_no_event", `"${n.label}" waits for an unnamed event.`, n.id);
        break;
      case "notification":
        if (!n.message.trim()) push("error", "notification_no_message", `"${n.label}" has an empty message.`, n.id);
        if (n.channels.length === 0) push("error", "notification_no_channel", `"${n.label}" has no channel.`, n.id);
        break;
      case "artifact_output":
        if (!ids.has(n.sourceNodeId)) push("error", "artifact_bad_source", `"${n.label}" reads from a node that does not exist.`, n.id);
        break;
      case "join":
        if (n.dependencies.length < 2) push("warning", "join_single_input", `"${n.label}" joins fewer than two inputs.`, n.id);
        if (n.strategy === "n_of_m" && (!n.n || n.n < 1)) push("error", "join_bad_n", `"${n.label}" needs n ≥ 1 for an n-of-m join.`, n.id);
        break;
      case "deterministic":
        if (!n.functionRef) push("error", "deterministic_no_function", `"${n.label}" has no function.`, n.id);
        break;
      default:
        break;
    }
  }

  // Stable order: errors first, then by node id for deterministic UIs.
  problems.sort((a, b) => (a.severity === b.severity ? (a.nodeId ?? "").localeCompare(b.nodeId ?? "") : a.severity === "error" ? -1 : 1));
  return { problems, ok: !problems.some((p) => p.severity === "error") };
}

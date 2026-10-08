/**
 * XR — canvas ⇄ canonical workflow compiler (Phase 19).
 *
 * The desktop's visual editor works with a small, UI-shaped graph
 * (`CanvasGraph`). It is NOT a second workflow format: before anything is
 * saved or run it is compiled DOWN to the canonical `WorkflowDefinition`
 * node union through the factories in `nodes.ts`, and the canonical nodes are
 * what the engine executes. The canvas-only facts (positions, which palette
 * stencil produced a node) travel in `node.metadata.canvas` so a saved
 * definition reopens with its layout.
 *
 * Pure functions, no I/O. The agent resolver is injected so the compiler can
 * pin a Sub-agent node to a real built-in or custom agent definition.
 */
import type { AgentDefinition, AgentPermissionProfile, AgentRole, ToolScope } from "../../agents/types.ts";
import * as n from "./nodes.ts";
import type {
  AgenticNode,
  ArtifactContract,
  BranchCondition,
  BranchNode,
  HumanApprovalNode,
  HumanReviewNode,
  JoinNode,
  NotificationNode,
  ToolActionNode,
  WaitTimerNode,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowParameter,
} from "./types.ts";

// ── Canvas model ───────────────────────────────────────────────────────────

export type CanvasNodeKind =
  | "input"
  | "llm"
  | "subagent"
  | "tool"
  | "branch"
  | "join"
  | "human_approval"
  | "human_review"
  | "wait"
  | "notification"
  | "artifact"
  | "output";

export const CANVAS_NODE_KINDS: readonly CanvasNodeKind[] = [
  "input", "llm", "subagent", "tool", "branch", "join", "human_approval", "human_review", "wait", "notification", "artifact", "output",
];

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  label: string;
  position: CanvasPosition;
  /** Kind-specific configuration edited in the inspector (see `defaultConfig`). */
  config: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  source: string;
  /** Branch nodes expose `true` / `false` handles; every other node has one source handle. */
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CompileOptions {
  /** Resolve a Sub-agent / LLM node's pinned agent id to its definition. */
  resolveAgent?: (id: string) => AgentDefinition | undefined;
}

export interface CompiledGraph {
  nodes: WorkflowNode[];
  entryNodeIds: string[];
  parameters: WorkflowParameter[];
}

const NONE_PERMS: AgentPermissionProfile = {
  writeFiles: false,
  shell: false,
  network: false,
  plugins: false,
  mcp: false,
  memoryRead: false,
  memoryWrite: false,
  computerControl: false,
  secrets: false,
  destructiveExec: false,
};

const AGENT_ROLES: readonly AgentRole[] = [
  "supervisor", "planner", "researcher", "builder", "reviewer", "executor", "synthesizer", "verifier", "memory_manager", "router",
  "model_selector", "security_checker", "full_stack", "frontend", "backend", "devops", "mobile", "data_ml", "security_analyst",
  "soc_threat_hunter", "academic_research", "market_research", "business_sales", "support_ops",
];

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Default inspector configuration for a freshly dropped stencil. */
export function defaultConfig(kind: CanvasNodeKind): Record<string, unknown> {
  switch (kind) {
    case "input":
      return { paramName: "", paramType: "string", required: false, defaultValue: "", description: "" };
    case "llm":
      return { agentRole: "executor", instruction: "", systemPrompt: "", provider: "", model: "", maxUsd: 0.5, maxSteps: 8, tools: [], riskTier: "low", requiresReview: false };
    case "subagent":
      return { agentId: "", instruction: "", maxUsd: 0.5, maxSteps: 8 };
    case "tool":
      return { tool: "", args: {}, requiresApproval: false, maxRetries: 0, backoffMs: 1000, riskTier: "medium" };
    case "branch":
      return { conditionType: "field_compare", field: "", operator: "eq", value: "", expression: "", nodeId: "" };
    case "join":
      return { strategy: "all", n: 1, timeoutMs: 0, onTimeout: "fail" };
    case "human_approval":
      return { summary: "", detail: "", riskLevel: "medium", approver: "any_human", expiresInMs: 86_400_000, onExpiry: "deny", onDenial: "stop_workflow" };
    case "human_review":
      return { summary: "", detail: "", expiresInMs: 86_400_000, onChangeRequested: "retry_targets", onExpiry: "block" };
    case "wait":
      return { mode: "delay", durationMs: 5000, eventName: "" };
    case "notification":
      return { message: "", severity: "info", recipient: "user" };
    case "artifact":
      return { type: "report", format: "markdown", description: "", storagePath: "" };
    case "output":
      return { message: "", outcome: "success" };
  }
}

export function defaultLabel(kind: CanvasNodeKind): string {
  switch (kind) {
    case "input": return "Input";
    case "llm": return "LLM";
    case "subagent": return "Sub-agent";
    case "tool": return "Tool";
    case "branch": return "Branch";
    case "join": return "Join";
    case "human_approval": return "Human approval";
    case "human_review": return "Human review";
    case "wait": return "Wait";
    case "notification": return "Notification";
    case "artifact": return "Artifact";
    case "output": return "Output";
  }
}

// ── Compile ────────────────────────────────────────────────────────────────

export class CanvasCompileError extends Error {
  constructor(message: string, readonly nodeId?: string) {
    super(message);
    this.name = "CanvasCompileError";
  }
}

/**
 * Compile a canvas graph into canonical nodes. Structural validity is NOT
 * enforced here (that is the linter's job, so the author sees every problem
 * at once); only facts the factories need are checked.
 */
export function compileCanvas(graph: CanvasGraph, opts: CompileOptions = {}): CompiledGraph {
  const ids = new Set(graph.nodes.map((c) => c.id));
  const inbound = new Map<string, CanvasEdge[]>();
  const outbound = new Map<string, CanvasEdge[]>();
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    inbound.set(e.target, [...(inbound.get(e.target) ?? []), e]);
    outbound.set(e.source, [...(outbound.get(e.source) ?? []), e]);
  }
  const deps = (id: string): string[] => [...new Set((inbound.get(id) ?? []).map((e) => e.source))];
  const next = (id: string, handle?: string): string[] =>
    [...new Set((outbound.get(id) ?? []).filter((e) => (handle ? (e.sourceHandle ?? "true") === handle : true)).map((e) => e.target))];

  const parameters: WorkflowParameter[] = [];
  const nodes: WorkflowNode[] = graph.nodes.map((c) => {
    const base = { dependencies: deps(c.id), description: str(c.config.description) || undefined };
    const meta = { canvas: { x: c.position.x, y: c.position.y, kind: c.kind, config: c.config } };
    const withId = <T extends WorkflowNode>(node: T): T => ({ ...node, id: c.id, metadata: { ...(node.metadata ?? {}), ...meta } });
    const label = c.label.trim() || defaultLabel(c.kind);

    switch (c.kind) {
      case "input": {
        const paramName = str(c.config.paramName).trim();
        if (paramName) {
          const type = str(c.config.paramType, "string");
          parameters.push({
            name: paramName,
            type: type === "number" || type === "boolean" || type === "json" ? type : "string",
            required: bool(c.config.required, false),
            ...(str(c.config.defaultValue) ? { default: c.config.defaultValue } : {}),
            ...(str(c.config.description) ? { description: str(c.config.description) } : {}),
          });
        }
        return withId(n.trigger(label, { type: "manual", description: str(c.config.description) || undefined }, { dependencies: [], metadata: {} }));
      }
      case "llm":
      case "subagent": {
        const agentId = str(c.config.agentId).trim();
        const agent = agentId && opts.resolveAgent ? opts.resolveAgent(agentId) : undefined;
        if (c.kind === "subagent" && agentId && !agent) throw new CanvasCompileError(`Unknown agent "${agentId}"`, c.id);
        const roleRaw = agent?.role ?? str(c.config.agentRole, "executor");
        const agentRole: AgentRole = (AGENT_ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as AgentRole) : "executor";
        const tools = strList(c.config.tools);
        const toolScope: ToolScope = agent ? agent.toolScope : { mode: "allowlist", tools };
        const permissions: AgentPermissionProfile = agent ? agent.permissions : permissionsForTools(tools);
        const provider = str(c.config.provider).trim();
        const model = str(c.config.model).trim();
        const maxUsd = num(c.config.maxUsd, 0.5);
        const maxSteps = Math.max(1, Math.round(num(c.config.maxSteps, 8)));
        const node: AgenticNode = n.agentic(label, str(c.config.instruction), agentRole, {
          ...base,
          ...(agent ? { agentId: agent.id } : {}),
          toolScope,
          permissions,
          providerScope: {
            ...(agent?.providerScope ?? {}),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
          },
          budget: { maxUsd, maxSteps, ...(c.config.maxTokens ? { maxTokens: num(c.config.maxTokens, 0) || undefined } : {}) },
          riskTier: riskTier(c.config.riskTier, permissions.shell || permissions.destructiveExec ? "high" : permissions.writeFiles ? "medium" : "low"),
          requiresReview: bool(c.config.requiresReview, false),
          ...(str(c.config.systemPrompt).trim() ? { systemPrompt: str(c.config.systemPrompt) } : {}),
          contextScope: { tiers: [], includeUserMemory: false },
        });
        return withId(node);
      }
      case "tool": {
        const tool = str(c.config.tool).trim();
        const args = record(c.config.args);
        const node: ToolActionNode = n.toolAction(label, { family: "core_tool", name: tool }, args, {
          ...base,
          inputSummary: `${tool} ${summarizeArgs(args)}`.trim().slice(0, 200),
          riskTier: riskTier(c.config.riskTier, "medium"),
          requiresApproval: bool(c.config.requiresApproval, false),
          retry: { maxRetries: Math.max(0, Math.round(num(c.config.maxRetries, 0))), backoffMs: Math.max(0, num(c.config.backoffMs, 1000)), exponentialBackoff: true, retryableErrors: ["transient", "timeout", "rate_limited"] },
        });
        return withId(node);
      }
      case "branch": {
        const node: BranchNode = n.branch(label, branchCondition(c.config), next(c.id, "true"), next(c.id, "false"), { ...base, defaultNodes: [] });
        return withId(node);
      }
      case "join": {
        const strategy = str(c.config.strategy, "all");
        const node: JoinNode = n.join(label, strategy === "any" || strategy === "n_of_m" ? strategy : "all", {
          ...base,
          n: Math.max(1, Math.round(num(c.config.n, 1))),
          timeoutMs: Math.max(0, num(c.config.timeoutMs, 0)),
          onTimeout: onTimeout(c.config.onTimeout),
        });
        return withId(node);
      }
      case "human_approval": {
        const approverKind = str(c.config.approver, "any_human");
        const node: HumanApprovalNode = n.humanApproval(label, str(c.config.summary), str(c.config.detail), { kind: approverKind === "workspace_owner" || approverKind === "any_reviewer" ? approverKind : "any_human" }, {
          ...base,
          riskLevel: riskTier(c.config.riskLevel, "medium"),
          scope: str(c.config.scope) || label,
          expiresInMs: Math.max(0, num(c.config.expiresInMs, 86_400_000)),
          onApproval: { nextNodes: next(c.id) },
          onDenial: { action: str(c.config.onDenial) === "skip" ? "skip" : "stop_workflow" },
          onExpiry: { action: str(c.config.onExpiry) === "auto_approve" ? "auto_approve" : "deny" },
        });
        return withId(node);
      }
      case "human_review": {
        const targets = strList(c.config.reviewTargetNodes).filter((id) => ids.has(id));
        const node: HumanReviewNode = n.humanReview(label, str(c.config.summary), targets.length ? targets : deps(c.id), { kind: "any_human" }, {
          ...base,
          detail: str(c.config.detail),
          expiresInMs: Math.max(0, num(c.config.expiresInMs, 86_400_000)),
          onApprove: { nextNodes: next(c.id) },
          onChangeRequested: { action: str(c.config.onChangeRequested) === "escalate" ? "escalate" : "retry_targets" },
          onExpiry: { action: str(c.config.onExpiry) === "auto_approve" ? "auto_approve" : "block" },
        });
        return withId(node);
      }
      case "wait": {
        const timer: WaitTimerNode["timer"] =
          str(c.config.mode, "delay") === "event"
            ? { type: "event", eventName: str(c.config.eventName) }
            : { type: "delay", durationMs: Math.max(0, Math.round(num(c.config.durationMs, 5000))) };
        return withId(n.waitTimer(label, timer, base));
      }
      case "notification": {
        const sev = str(c.config.severity, "info");
        const node: NotificationNode = n.notification(label, str(c.config.message), ["dashboard"], [{ kind: "user", id: str(c.config.recipient, "user") || "user" }], {
          ...base,
          severity: sev === "warning" || sev === "critical" ? sev : "info",
        });
        return withId(node);
      }
      case "artifact": {
        const type = str(c.config.type, "report");
        const contract: ArtifactContract = {
          type: (["report", "code", "document", "dataset", "configuration", "evidence_package", "decision_record", "custom"] as const).includes(type as never) ? (type as ArtifactContract["type"]) : "custom",
          format: str(c.config.format, "markdown") || "markdown",
          description: str(c.config.description) || label,
          ...(str(c.config.storagePath).trim() ? { storagePath: str(c.config.storagePath).trim() } : {}),
        };
        return withId(n.artifactOutput(label, contract, deps(c.id)[0] ?? "", base));
      }
      case "output": {
        const outcome = str(c.config.outcome, "success");
        return withId(n.completion(label, str(c.config.message), { ...base, outcome: outcome === "partial_success" || outcome === "no_op" ? outcome : "success" }));
      }
      default:
        throw new CanvasCompileError(`Unknown node kind "${String((c as { kind: unknown }).kind)}"`, c.id);
    }
  });

  const entryNodeIds = n.entryNodes(nodes).map((x) => x.id);
  return { nodes, entryNodeIds, parameters };
}

function permissionsForTools(tools: string[]): AgentPermissionProfile {
  const t = new Set(tools);
  return {
    ...NONE_PERMS,
    writeFiles: t.has("write_file") || t.has("edit_file") || t.has("apply_patch") || t.has("delete_file") || t.has("move_file"),
    shell: t.has("shell") || t.has("run_command") || t.has("git"),
    network: t.has("fetch_url") || t.has("web_search") || t.has("http_post") || t.has("web_browse"),
    memoryRead: t.has("memory_read") || t.has("memory_search"),
    memoryWrite: t.has("memory_write") || t.has("memory_save"),
  };
}

function riskTier(v: unknown, fallback: "low" | "medium" | "high"): "low" | "medium" | "high" {
  return v === "low" || v === "medium" || v === "high" ? v : fallback;
}

function onTimeout(v: unknown): JoinNode["onTimeout"] {
  return v === "proceed_partial" || v === "skip" ? v : "fail";
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args).slice(0, 4).map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 40) : JSON.stringify(v)?.slice(0, 40) ?? ""}`);
  return parts.join(" ");
}

function branchCondition(config: Record<string, unknown>): BranchCondition {
  const type = str(config.conditionType, "field_compare");
  const field = str(config.field);
  switch (type) {
    case "field_exists":
      return { type, field };
    case "field_is_empty":
      return { type, field };
    case "expression":
      return { type, expression: str(config.expression), description: str(config.description) || "expression" };
    case "approval_granted":
    case "approval_denied":
    case "review_approved":
    case "review_changes_requested":
      return { type, nodeId: str(config.nodeId) };
    default: {
      const op = str(config.operator, "eq");
      const operator: Extract<BranchCondition, { type: "field_compare" }>["operator"] =
        op === "neq" || op === "gt" || op === "lt" || op === "gte" || op === "lte" || op === "contains" || op === "in" ? op : "eq";
      return { type: "field_compare", field, operator, value: coerceValue(config.value) };
    }
  }
}

function coerceValue(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return v;
}

// ── Decompile ──────────────────────────────────────────────────────────────

/**
 * Rebuild the editor graph from a canonical definition. Definitions authored
 * through the canvas carry their editor state in `metadata.canvas` (lossless);
 * definitions authored elsewhere (CLI, tests, templates) are derived from the
 * canonical fields and laid out in dependency layers.
 */
export function decompileDefinition(def: Pick<WorkflowDefinition, "nodes">): CanvasGraph {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const layers = layerFor(def.nodes);

  for (const node of def.nodes) {
    const meta = record(record(node.metadata).canvas);
    const kind = canvasKindOf(node, str(meta.kind));
    const stored = record(meta.config);
    const position = { x: num(meta.x, 80 + (layers.get(node.id) ?? 0) * 280), y: num(meta.y, 80 + indexInLayer(def.nodes, layers, node.id) * 140) };
    nodes.push({ id: node.id, kind, label: node.label, position, config: Object.keys(stored).length ? stored : deriveConfig(node) });
    for (const dep of node.dependencies) {
      const source = def.nodes.find((x) => x.id === dep);
      let sourceHandle: string | null = null;
      if (source?.kind === "branch") {
        sourceHandle = source.falseNodes.includes(node.id) && !source.trueNodes.includes(node.id) ? "false" : "true";
      }
      edges.push({ id: `e_${dep}_${node.id}${sourceHandle ? `_${sourceHandle}` : ""}`, source: dep, target: node.id, sourceHandle });
    }
  }
  return { nodes, edges };
}

function canvasKindOf(node: WorkflowNode, hinted: string): CanvasNodeKind {
  if ((CANVAS_NODE_KINDS as readonly string[]).includes(hinted)) return hinted as CanvasNodeKind;
  switch (node.kind) {
    case "trigger": return "input";
    case "agentic": return node.agentId ? "subagent" : "llm";
    case "tool_action": return "tool";
    case "branch": return "branch";
    case "join": return "join";
    case "human_approval": return "human_approval";
    case "human_review": return "human_review";
    case "wait_timer": return "wait";
    case "notification": return "notification";
    case "artifact_output": return "artifact";
    case "completion": return "output";
    default: return "tool";
  }
}

function deriveConfig(node: WorkflowNode): Record<string, unknown> {
  switch (node.kind) {
    case "agentic":
      return {
        ...defaultConfig(node.agentId ? "subagent" : "llm"),
        ...(node.agentId ? { agentId: node.agentId } : {}),
        agentRole: node.agentRole,
        instruction: node.instruction,
        systemPrompt: node.systemPrompt ?? "",
        provider: node.providerScope.provider ?? "",
        model: node.providerScope.model ?? "",
        maxUsd: node.budget?.maxUsd ?? 0.5,
        maxSteps: node.budget?.maxSteps ?? 8,
        tools: node.toolScope.mode === "allowlist" ? node.toolScope.tools : [],
        riskTier: node.riskTier,
        requiresReview: node.requiresReview,
      };
    case "tool_action":
      return { ...defaultConfig("tool"), tool: node.capability.name, args: node.inputs, requiresApproval: node.requiresApproval, maxRetries: node.retry.maxRetries, backoffMs: node.retry.backoffMs, riskTier: node.riskTier };
    case "branch": {
      const c = node.condition;
      return {
        ...defaultConfig("branch"),
        conditionType: c.type,
        ...("field" in c ? { field: c.field } : {}),
        ...(c.type === "field_compare" ? { operator: c.operator, value: c.value } : {}),
        ...(c.type === "expression" ? { expression: c.expression } : {}),
        ...("nodeId" in c ? { nodeId: c.nodeId } : {}),
      };
    }
    case "join":
      return { strategy: node.strategy, n: node.n ?? 1, timeoutMs: node.timeoutMs, onTimeout: node.onTimeout };
    case "human_approval":
      return { summary: node.request.summary, detail: node.request.detail, riskLevel: node.request.riskLevel, approver: node.approver.kind, expiresInMs: node.expiresInMs, onExpiry: node.onExpiry.action, onDenial: node.onDenial.action };
    case "human_review":
      return { summary: node.request.summary, detail: node.request.detail, reviewTargetNodes: node.request.reviewTargetNodes, expiresInMs: node.expiresInMs, onChangeRequested: node.onChangeRequested.action, onExpiry: node.onExpiry.action };
    case "wait_timer":
      return node.timer.type === "event" ? { mode: "event", durationMs: 5000, eventName: node.timer.eventName } : { mode: "delay", durationMs: node.timer.type === "delay" ? node.timer.durationMs : 0, eventName: "" };
    case "notification":
      return { message: node.message, severity: node.severity, recipient: node.recipients[0]?.id ?? "user" };
    case "artifact_output":
      return { type: node.artifact.type, format: node.artifact.format, description: node.artifact.description, storagePath: node.artifact.storagePath ?? "" };
    case "completion":
      return { message: node.message, outcome: node.outcome };
    case "trigger":
      return { ...defaultConfig("input"), description: node.description ?? "" };
    default:
      return {};
  }
}

/** Longest-path layer index per node (0 = entry). */
export function layerFor(nodes: Array<{ id: string; dependencies: string[] }>): Map<string, number> {
  const layer = new Map<string, number>();
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const visit = (id: string, stack: Set<string>): number => {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) return 0; // cycle guard — the linter reports it
    stack.add(id);
    const node = byId.get(id);
    const depth = node && node.dependencies.length ? Math.max(...node.dependencies.map((d) => (byId.has(d) ? visit(d, stack) + 1 : 0))) : 0;
    stack.delete(id);
    layer.set(id, depth);
    return depth;
  };
  for (const x of nodes) visit(x.id, new Set());
  return layer;
}

function indexInLayer(nodes: WorkflowNode[], layers: Map<string, number>, id: string): number {
  const mine = layers.get(id) ?? 0;
  let i = 0;
  for (const x of nodes) {
    if (x.id === id) return i;
    if ((layers.get(x.id) ?? 0) === mine) i++;
  }
  return i;
}

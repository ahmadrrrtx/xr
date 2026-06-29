/**
 * XR Stage 12 — Built-in agent registry.
 *
 * These definitions are intentionally explicit. An agent is not just a prompt:
 * it has a role, capability set, tool scope, memory scope, provider preference,
 * and permission profile.
 */

import type {
  AgentDefinition,
  AgentPermissionProfile,
  AgentRole,
  MemoryScope,
  ToolScope,
} from "./types.ts";

const NONE: AgentPermissionProfile = {
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

function perms(patch: Partial<AgentPermissionProfile>): AgentPermissionProfile {
  return { ...NONE, ...patch };
}

function memory(
  kind: MemoryScope["kind"],
  maxEntries: number,
  patch: Partial<MemoryScope> = {},
): MemoryScope {
  return {
    kind,
    maxEntries,
    sharedWithSupervisor: true,
    includeUserMemory: false,
    ...patch,
  };
}

function allow(...tools: string[]): ToolScope {
  return { mode: "allowlist", tools };
}

function deny(...tools: string[]): ToolScope {
  return { mode: "denylist", tools };
}

const CORE_VERSION = "12.0.0";

function def(agent: AgentDefinition): AgentDefinition {
  return agent;
}

const BUILTIN: AgentDefinition[] = [
  def({
    id: "supervisor",
    role: "supervisor",
    label: "Supervisor / Coordinator",
    description: "Owns workflow state, delegation, blocking, review gates, and final completion.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["task-routing", "handoff-control", "review-gates", "resume-cancel", "audit"],
    permissions: perms({ memoryRead: true }),
    toolScope: allow(),
    memoryScope: memory("workflow", 6, { includeUserMemory: true }),
    providerScope: {},
  }),
  def({
    id: "planner",
    role: "planner",
    label: "Planner",
    description: "Converts the assigned objective into an explicit plan and execution checklist.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["task-decomposition", "dependency-mapping", "risk-surfacing"],
    permissions: perms({ network: true, memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url", "web_search", "check_package"),
    memoryScope: memory("workflow", 4, { includeUserMemory: true }),
    providerScope: {},
  }),
  def({
    id: "researcher",
    role: "researcher",
    label: "Researcher",
    description: "Collects evidence, repo context, ecosystem facts, and counterpoints.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["evidence-gathering", "repo-reading", "counter-analysis"],
    permissions: perms({ network: true, memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url", "web_search", "check_package"),
    memoryScope: memory("research", 4, { includeUserMemory: false }),
    providerScope: {},
  }),
  def({
    id: "builder",
    role: "builder",
    label: "Builder / Developer",
    description: "Implements approved repository changes inside the current workspace.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["code-writing", "refactoring", "test-driving"],
    permissions: perms({ writeFiles: true, shell: true, network: true, plugins: true, mcp: true, memoryRead: true }),
    toolScope: allow("read_file", "write_file", "list_dir", "shell", "fetch_url", "check_package"),
    memoryScope: memory("project", 4, { includeUserMemory: true }),
    providerScope: {},
  }),
  def({
    id: "reviewer",
    role: "reviewer",
    label: "Reviewer",
    description: "Separates critique from generation and can request changes before merge/synthesis.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["quality-review", "logic-check", "change-requests"],
    permissions: perms({ network: true, memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url", "check_package"),
    memoryScope: memory("workflow", 4, { includeUserMemory: false }),
    providerScope: {},
  }),
  def({
    id: "executor",
    role: "executor",
    label: "Executor",
    description: "Runs approved execution tasks with the narrowest possible side-effect scope.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["approved-execution", "computer-control", "controlled-side-effects"],
    permissions: perms({ writeFiles: true, shell: true, computerControl: true, network: true }),
    toolScope: allow("computer_control", "read_file", "write_file", "list_dir", "shell"),
    memoryScope: memory("workflow", 2, { includeUserMemory: false }),
    providerScope: {},
  }),
  def({
    id: "synthesizer",
    role: "synthesizer",
    label: "Synthesizer",
    description: "Combines reviewed worker outputs into the final user-facing answer.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["result-composition", "summary", "final-delivery"],
    permissions: perms({ memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url"),
    memoryScope: memory("workflow", 6, { includeUserMemory: false }),
    providerScope: {},
  }),
  def({
    id: "memory-manager",
    role: "memory_manager",
    label: "Memory Manager",
    description: "Prepares scoped memory packages and prevents broad memory bleed between workers.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["memory-briefing", "scope-control", "recall-packaging"],
    permissions: perms({ memoryRead: true, memoryWrite: true }),
    toolScope: allow(),
    memoryScope: memory("user", 8, { includeUserMemory: true, sharedWithSupervisor: true }),
    providerScope: {},
  }),
  def({
    id: "router",
    role: "router",
    label: "Router",
    description: "Routes the workflow to the right built-in agent roles and determines task kind.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["workflow-kind-detection", "agent-selection"],
    permissions: perms({}),
    toolScope: allow(),
    memoryScope: memory("none", 0, { sharedWithSupervisor: false }),
    providerScope: {},
  }),
  def({
    id: "model-selector",
    role: "model_selector",
    label: "Router / Model Selector",
    description: "Chooses provider/model strategy per agent role when overrides are useful.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["provider-routing", "cost-awareness", "role-specific-model-picks"],
    permissions: perms({}),
    toolScope: allow(),
    memoryScope: memory("none", 0, { sharedWithSupervisor: false }),
    providerScope: {},
  }),
  def({
    id: "security-checker",
    role: "security_checker",
    label: "Security Checker",
    description: "Performs deterministic and model-assisted safety review before risky execution proceeds.",
    version: CORE_VERSION,
    enabledByDefault: true,
    capabilities: ["policy-check", "prompt-injection-screen", "execution-blocking"],
    permissions: perms({ network: true, memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url", "check_package"),
    memoryScope: memory("workflow", 3, { includeUserMemory: false }),
    providerScope: {},
  }),

  // Expansion-ready professional packs.
  def({
    id: "full-stack-developer",
    role: "full_stack",
    label: "Full Stack Developer Agent",
    description: "An optional composite specialist for cross-cutting web application work.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["frontend", "backend", "integration"],
    permissions: perms({ writeFiles: true, shell: true, network: true, plugins: true, mcp: true, memoryRead: true }),
    toolScope: allow("read_file", "write_file", "list_dir", "shell", "fetch_url", "check_package"),
    memoryScope: memory("project", 4, { includeUserMemory: true }),
    providerScope: {},
  }),
  def({
    id: "frontend-agent",
    role: "frontend",
    label: "Frontend Agent",
    description: "Optional UI specialist for client-side architecture and implementation.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["ui-implementation", "ux-review", "component-work"],
    permissions: perms({ writeFiles: true, shell: true, memoryRead: true }),
    toolScope: allow("read_file", "write_file", "list_dir", "shell"),
    memoryScope: memory("project", 3, { includeUserMemory: true }),
    providerScope: {},
  }),
  def({
    id: "backend-agent",
    role: "backend",
    label: "Backend Agent",
    description: "Optional server-side/API specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["api-work", "data-modeling", "integration"],
    permissions: perms({ writeFiles: true, shell: true, network: true, memoryRead: true }),
    toolScope: allow("read_file", "write_file", "list_dir", "shell", "fetch_url", "check_package"),
    memoryScope: memory("project", 3, { includeUserMemory: true }),
    providerScope: {},
  }),
  def({
    id: "devops-agent",
    role: "devops",
    label: "DevOps Agent",
    description: "Optional infrastructure and deployment specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["deployment", "ci-cd", "ops-hardening"],
    permissions: perms({ writeFiles: true, shell: true, network: true, mcp: true, destructiveExec: true }),
    toolScope: allow("read_file", "write_file", "list_dir", "shell", "fetch_url"),
    memoryScope: memory("project", 2, { includeUserMemory: false }),
    providerScope: {},
  }),
  def({
    id: "mobile-agent",
    role: "mobile",
    label: "Mobile Agent",
    description: "Optional iOS/Android specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["mobile-ui", "native-architecture"],
    permissions: perms({ writeFiles: true, shell: true, memoryRead: true }),
    toolScope: allow("read_file", "write_file", "list_dir", "shell"),
    memoryScope: memory("project", 3, { includeUserMemory: true }),
    providerScope: {},
  }),
  def({
    id: "data-ml-agent",
    role: "data_ml",
    label: "Data / ML Agent",
    description: "Optional data-science and ML workflow specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["data-analysis", "modeling", "evaluation"],
    permissions: perms({ writeFiles: true, shell: true, network: true, memoryRead: true }),
    toolScope: allow("read_file", "write_file", "list_dir", "shell", "fetch_url", "check_package"),
    memoryScope: memory("project", 3),
    providerScope: {},
  }),
  def({
    id: "security-analyst-agent",
    role: "security_analyst",
    label: "Security Analyst Agent",
    description: "Optional application security specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["threat-modeling", "code-audit", "control-review"],
    permissions: perms({ network: true, memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url", "check_package"),
    memoryScope: memory("workflow", 3),
    providerScope: {},
  }),
  def({
    id: "soc-threat-hunter-agent",
    role: "soc_threat_hunter",
    label: "SOC / Threat Hunter Agent",
    description: "Optional incident-response and threat-hunting specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["incident-triage", "log-analysis", "risk-hunting"],
    permissions: perms({ network: true, memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url"),
    memoryScope: memory("workflow", 3),
    providerScope: {},
  }),
  def({
    id: "academic-research-agent",
    role: "academic_research",
    label: "Academic Research Agent",
    description: "Optional literature and citation specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["literature-review", "citation-gathering", "source-comparison"],
    permissions: perms({ network: true, memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url", "web_search"),
    memoryScope: memory("research", 4),
    providerScope: {},
  }),
  def({
    id: "market-research-agent",
    role: "market_research",
    label: "Market Research Agent",
    description: "Optional market and competitor intelligence specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["market-scanning", "competitor-analysis"],
    permissions: perms({ network: true, memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url", "web_search"),
    memoryScope: memory("research", 4),
    providerScope: {},
  }),
  def({
    id: "business-sales-agent",
    role: "business_sales",
    label: "Business / Sales Agent",
    description: "Optional business-development and sales workflow specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["outreach-planning", "account-briefing", "business-writing"],
    permissions: perms({ network: true, memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url", "web_search"),
    memoryScope: memory("workflow", 4, { includeUserMemory: true }),
    providerScope: {},
  }),
  def({
    id: "support-ops-agent",
    role: "support_ops",
    label: "Support / Ops Agent",
    description: "Optional operational support specialist.",
    version: CORE_VERSION,
    enabledByDefault: false,
    capabilities: ["incident-summary", "ops-runbook-support"],
    permissions: perms({ memoryRead: true }),
    toolScope: allow("read_file", "list_dir", "fetch_url"),
    memoryScope: memory("workflow", 3),
    providerScope: {},
  }),
];

const BY_ID = new Map(BUILTIN.map((a) => [a.id, a]));
const BY_ROLE = new Map<AgentRole, AgentDefinition[]>(
  BUILTIN.reduce((acc, agent) => {
    const list = acc.get(agent.role) ?? [];
    list.push(agent);
    acc.set(agent.role, list);
    return acc;
  }, new Map<AgentRole, AgentDefinition[]>()),
);

export function listAgents(opts: { includeDisabled?: boolean } = {}): AgentDefinition[] {
  return BUILTIN.filter((agent) => opts.includeDisabled || agent.enabledByDefault)
    .map((agent) => ({
      ...agent,
      capabilities: [...agent.capabilities],
      toolScope: { ...agent.toolScope, tools: [...agent.toolScope.tools] },
      permissions: { ...agent.permissions },
      memoryScope: { ...agent.memoryScope },
      providerScope: { ...agent.providerScope },
    }));
}

export function getAgentDefinition(id: string): AgentDefinition | undefined {
  const agent = BY_ID.get(id);
  return agent ? { ...agent, capabilities: [...agent.capabilities], toolScope: { ...agent.toolScope, tools: [...agent.toolScope.tools] }, permissions: { ...agent.permissions }, memoryScope: { ...agent.memoryScope }, providerScope: { ...agent.providerScope } } : undefined;
}

export function getAgentByRole(role: AgentRole): AgentDefinition | undefined {
  const list = BY_ROLE.get(role) ?? [];
  const preferred = list.find((agent) => agent.enabledByDefault) ?? list[0];
  return preferred ? getAgentDefinition(preferred.id) : undefined;
}

export function hasAgent(id: string): boolean {
  return BY_ID.has(id);
}

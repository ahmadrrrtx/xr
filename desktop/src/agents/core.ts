/*
 * Agents (Phase 19) — pure model + helpers shared by the stores, the screen
 * and the tests. Mirrors the engine's shapes (src/agents/types.ts,
 * src/agents/custom-store.ts) without importing them: the desktop talks to
 * the daemon over HTTP, so these are the wire types.
 *
 * Nothing here touches the DOM or the network.
 */

export type RoleFamily = 'coder' | 'researcher' | 'writer' | 'analyst' | 'designer' | 'ops' | 'general';

export const ROLE_FAMILIES: readonly { id: RoleFamily; label: string }[] = [
  { id: 'coder', label: 'Coder' },
  { id: 'researcher', label: 'Researcher' },
  { id: 'writer', label: 'Writer' },
  { id: 'analyst', label: 'Analyst' },
  { id: 'designer', label: 'Designer' },
  { id: 'ops', label: 'Ops' },
  { id: 'general', label: 'General' },
];

/** Engine agent roles (src/agents/types.ts `AgentRole`). */
export const AGENT_ROLES = [
  'supervisor', 'planner', 'researcher', 'builder', 'reviewer', 'executor', 'synthesizer', 'verifier',
  'memory_manager', 'router', 'model_selector', 'security_checker', 'full_stack', 'frontend', 'backend',
  'devops', 'mobile', 'data_ml', 'security_analyst', 'soc_threat_hunter', 'academic_research',
  'market_research', 'business_sales', 'support_ops',
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

const FAMILY_OF: Record<AgentRole, RoleFamily> = {
  builder: 'coder',
  full_stack: 'coder',
  backend: 'coder',
  mobile: 'coder',
  researcher: 'researcher',
  academic_research: 'researcher',
  market_research: 'researcher',
  synthesizer: 'writer',
  business_sales: 'writer',
  reviewer: 'analyst',
  verifier: 'analyst',
  data_ml: 'analyst',
  security_analyst: 'analyst',
  soc_threat_hunter: 'analyst',
  security_checker: 'analyst',
  frontend: 'designer',
  devops: 'ops',
  support_ops: 'ops',
  executor: 'ops',
  memory_manager: 'ops',
  supervisor: 'general',
  planner: 'general',
  router: 'general',
  model_selector: 'general',
};

export function isAgentRole(v: unknown): v is AgentRole {
  return typeof v === 'string' && (AGENT_ROLES as readonly string[]).includes(v);
}

export function familyOf(role: string): RoleFamily {
  return isAgentRole(role) ? FAMILY_OF[role] : 'general';
}

export function familyLabel(f: RoleFamily): string {
  return ROLE_FAMILIES.find((x) => x.id === f)?.label ?? 'General';
}

/** Human label for an engine role id (`soc_threat_hunter` → "SOC threat hunter"). */
export function roleLabel(role: string): string {
  const special: Partial<Record<AgentRole, string>> = {
    data_ml: 'Data / ML',
    soc_threat_hunter: 'SOC threat hunter',
    full_stack: 'Full stack',
    devops: 'DevOps',
    model_selector: 'Model selector',
  };
  if (isAgentRole(role) && special[role]) return special[role] as string;
  const s = role.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── Wire types ───────────────────────────────────────────────────────── */

export interface AgentPermissions {
  writeFiles: boolean;
  shell: boolean;
  network: boolean;
  plugins: boolean;
  mcp: boolean;
  memoryRead: boolean;
  memoryWrite: boolean;
  computerControl: boolean;
  secrets: boolean;
  destructiveExec: boolean;
}

export interface CustomAgentBudget {
  perRunUsd: number;
  perDayUsd: number;
}

export interface CustomAgentConstitution {
  askBeforeFileWrites: boolean;
  askBeforeShell: boolean;
  allowPublicWeb: boolean;
  memoryWrite: boolean;
  /** Always true — the engine refuses documents that turn this off. */
  destructiveApproval: true;
  shareData: boolean;
}

export const CUSTOM_AGENT_SCHEMA = 'xr-5.0.0/agent-v1';

export interface CustomAgent {
  schemaVersion: typeof CUSTOM_AGENT_SCHEMA;
  id: string;
  name: string;
  description: string;
  emoji: string;
  role: AgentRole;
  systemPrompt: string;
  tools: string[];
  provider?: string;
  model?: string;
  budget: CustomAgentBudget;
  constitution: CustomAgentConstitution;
  version: number;
  createdAt: number;
  updatedAt: number;
  basedOn?: string;
}

/** `GET /agents` → `agents[]` (builtin specialists + custom, same shape). */
export interface AgentSummary {
  id: string;
  role: string;
  label: string;
  description: string;
  version: string;
  enabledByDefault: boolean;
  capabilities: string[];
  permissions: AgentPermissions;
  toolScope: { mode: 'allowlist' | 'denylist'; tools: string[] };
  memoryScope: { kind: string; sharedWithSupervisor: boolean; maxEntries: number; includeUserMemory?: boolean };
  providerScope: { provider?: string; model?: string; strategy?: string; fallbacks?: string[] };
  builtin: boolean;
  custom?: CustomAgent;
}

export interface EngineTool {
  name: string;
  description: string;
  requiresApproval: boolean;
}

export interface CustomAgentInput {
  name: string;
  description?: string;
  emoji?: string;
  role?: AgentRole;
  systemPrompt: string;
  tools?: string[];
  provider?: string | null;
  model?: string | null;
  budget?: Partial<CustomAgentBudget>;
  constitution?: Partial<Omit<CustomAgentConstitution, 'destructiveApproval'>>;
  basedOn?: string | null;
}

/* ── Limits (mirror src/agents/custom-store.ts) ───────────────────────── */

export const AGENT_LIMITS = {
  nameMax: 60,
  descriptionMax: 280,
  emojiMax: 8,
  promptMin: 20,
  promptMax: 24_000,
  budgetMinUsd: 0.01,
  budgetMaxUsd: 5,
  toolsMax: 32,
} as const;

/* ── Editor form ──────────────────────────────────────────────────────── */

export interface AgentForm {
  name: string;
  description: string;
  emoji: string;
  role: AgentRole;
  systemPrompt: string;
  tools: string[];
  provider: string;
  model: string;
  budget: CustomAgentBudget;
  constitution: CustomAgentConstitution;
}

export const DEFAULT_CONSTITUTION: CustomAgentConstitution = {
  askBeforeFileWrites: true,
  askBeforeShell: true,
  allowPublicWeb: false,
  memoryWrite: false,
  destructiveApproval: true,
  shareData: false,
};

export function emptyAgentForm(): AgentForm {
  return {
    name: '',
    description: '',
    emoji: '🤖',
    role: 'executor',
    systemPrompt: '',
    tools: ['read_file', 'list_dir'],
    provider: '',
    model: '',
    budget: { perRunUsd: 0.5, perDayUsd: 2 },
    constitution: { ...DEFAULT_CONSTITUTION },
  };
}

export function formFromAgent(a: CustomAgent): AgentForm {
  return {
    name: a.name,
    description: a.description,
    emoji: a.emoji,
    role: a.role,
    systemPrompt: a.systemPrompt,
    tools: [...a.tools],
    provider: a.provider ?? '',
    model: a.model ?? '',
    budget: { ...a.budget },
    constitution: { ...a.constitution, destructiveApproval: true },
  };
}

/** Builtin specialist → an editable starting point ("Duplicate to My Agents"). */
export function formFromSummary(a: AgentSummary, tools: EngineTool[]): AgentForm {
  const known = new Set(tools.map((t) => t.name));
  const picked = a.toolScope.mode === 'allowlist' ? a.toolScope.tools.filter((t) => known.has(t)) : tools.map((t) => t.name);
  return {
    ...emptyAgentForm(),
    name: `${a.label} (copy)`.slice(0, AGENT_LIMITS.nameMax),
    description: a.description.slice(0, AGENT_LIMITS.descriptionMax),
    emoji: '🧬',
    role: isAgentRole(a.role) ? a.role : 'executor',
    systemPrompt: `You are ${a.label}. ${a.description}`.trim(),
    tools: picked.slice(0, AGENT_LIMITS.toolsMax),
    provider: a.providerScope.provider ?? '',
    model: a.providerScope.model ?? '',
    constitution: {
      ...DEFAULT_CONSTITUTION,
      allowPublicWeb: a.permissions.network,
      memoryWrite: a.permissions.memoryWrite,
    },
  };
}

export function toInput(f: AgentForm): CustomAgentInput {
  const { destructiveApproval: _always, ...constitution } = f.constitution;
  void _always;
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    emoji: f.emoji.trim() || '🤖',
    role: f.role,
    systemPrompt: f.systemPrompt.trim(),
    tools: [...new Set(f.tools)],
    provider: f.provider.trim() || null,
    model: f.model.trim() || null,
    budget: { perRunUsd: f.budget.perRunUsd, perDayUsd: f.budget.perDayUsd },
    constitution,
  };
}

export interface FieldProblem {
  path: string;
  message: string;
}

/** Client-side validation — the engine re-validates and is the authority. */
export function validateForm(f: AgentForm, tools: EngineTool[]): FieldProblem[] {
  const out: FieldProblem[] = [];
  const name = f.name.trim();
  if (!name) out.push({ path: 'name', message: 'Give the agent a name.' });
  else if (name.length > AGENT_LIMITS.nameMax) out.push({ path: 'name', message: `Keep the name under ${AGENT_LIMITS.nameMax} characters.` });
  if (f.description.trim().length > AGENT_LIMITS.descriptionMax) out.push({ path: 'description', message: `Keep the description under ${AGENT_LIMITS.descriptionMax} characters.` });
  const prompt = f.systemPrompt.trim();
  if (prompt.length < AGENT_LIMITS.promptMin) out.push({ path: 'systemPrompt', message: `System prompt needs at least ${AGENT_LIMITS.promptMin} characters.` });
  else if (prompt.length > AGENT_LIMITS.promptMax) out.push({ path: 'systemPrompt', message: `System prompt is over ${AGENT_LIMITS.promptMax.toLocaleString()} characters.` });
  if (!f.model.trim()) out.push({ path: 'model', message: 'Pick a model.' });
  if (tools.length) {
    const known = new Set(tools.map((t) => t.name));
    for (const t of f.tools) if (!known.has(t)) out.push({ path: 'tools', message: `Unknown tool “${t}”.` });
  }
  if (f.tools.length > AGENT_LIMITS.toolsMax) out.push({ path: 'tools', message: `At most ${AGENT_LIMITS.toolsMax} tools.` });
  for (const k of ['perRunUsd', 'perDayUsd'] as const) {
    const v = f.budget[k];
    if (!Number.isFinite(v) || v < AGENT_LIMITS.budgetMinUsd || v > AGENT_LIMITS.budgetMaxUsd) {
      out.push({ path: `budget.${k}`, message: `Budget must be between $${AGENT_LIMITS.budgetMinUsd} and $${AGENT_LIMITS.budgetMaxUsd}.` });
    }
  }
  if (f.budget.perRunUsd > f.budget.perDayUsd) out.push({ path: 'budget.perDayUsd', message: 'Per-day cap cannot be lower than the per-run cap.' });
  return out;
}

/* ── Import / export ──────────────────────────────────────────────────── */

/** Exported document = the stored record (the engine's import accepts it). */
export function exportDocument(a: CustomAgent): string {
  return `${JSON.stringify(a, null, 2)}\n`;
}

export function exportFileName(a: CustomAgent): string {
  const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
  return `xr-agent-${slug}.json`;
}

/**
 * Shallow shape check before an import round-trips to the engine, so a
 * wrong file fails here with a readable reason instead of a 400.
 */
export function parseImport(text: string): { ok: true; doc: Record<string, unknown> } | { ok: false; message: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That file is not valid JSON.' };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, message: 'Expected a JSON object describing one agent.' };
  const d = doc as Record<string, unknown>;
  if (d.schemaVersion !== undefined && d.schemaVersion !== CUSTOM_AGENT_SCHEMA) {
    return { ok: false, message: `Unsupported schema “${String(d.schemaVersion)}” (expected ${CUSTOM_AGENT_SCHEMA}).` };
  }
  if (typeof d.name !== 'string' || !d.name.trim()) return { ok: false, message: 'The document has no agent name.' };
  if (typeof d.systemPrompt !== 'string' || d.systemPrompt.trim().length < AGENT_LIMITS.promptMin) {
    return { ok: false, message: `The document needs a system prompt of at least ${AGENT_LIMITS.promptMin} characters.` };
  }
  return { ok: true, doc: d };
}

/* ── Search / filter ──────────────────────────────────────────────────── */

export function matchesQuery(a: { label: string; description: string; role: string; capabilities?: string[] }, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [a.label, a.description, a.role, roleLabel(a.role), ...(a.capabilities ?? [])].join(' ').toLowerCase();
  return needle.split(/\s+/).every((w) => hay.includes(w));
}

/** Mono chip line: "5 tools · project mem · claude-sonnet-4.5". */
export function chipLine(a: AgentSummary): string[] {
  const n = a.toolScope.mode === 'allowlist' ? a.toolScope.tools.length : a.capabilities.length;
  const mem = a.memoryScope.kind === 'none' ? 'no mem' : `${a.memoryScope.kind} mem`;
  const model = a.providerScope.model || (a.providerScope.provider ? a.providerScope.provider : 'default model');
  return [`${n} ${n === 1 ? 'tool' : 'tools'}`, mem, model];
}

/* ── Quick-start templates ────────────────────────────────────────────── */

export interface AgentTemplate {
  id: string;
  title: string;
  blurb: string;
  form: Omit<AgentForm, 'provider' | 'model'>;
}

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: 'code-reviewer',
    title: 'Code reviewer',
    blurb: 'Reads a diff or file, flags risks, suggests concrete fixes.',
    form: {
      name: 'Code reviewer',
      description: 'Reviews changes for correctness, security and clarity. Read-only.',
      emoji: '🔍',
      role: 'reviewer',
      systemPrompt:
        'You are a careful code reviewer. Read the files you are pointed at, then report: correctness bugs, security risks, unclear naming, missing tests. Quote the exact lines. Suggest minimal fixes. Never edit files yourself.',
      tools: ['read_file', 'list_dir'],
      budget: { perRunUsd: 0.25, perDayUsd: 2 },
      constitution: { ...DEFAULT_CONSTITUTION },
    },
  },
  {
    id: 'weekly-report',
    title: 'Weekly report writer',
    blurb: 'Turns notes and logs into a short, factual weekly summary.',
    form: {
      name: 'Weekly report writer',
      description: 'Summarises the week from the notes you give it. Plain language, no spin.',
      emoji: '📝',
      role: 'synthesizer',
      systemPrompt:
        'You write short weekly reports. Input: notes, commit logs or bullet points. Output: Done · In progress · Blocked · Next week, each as terse bullets with numbers where known. Do not invent progress. Mark anything uncertain.',
      tools: ['read_file'],
      budget: { perRunUsd: 0.25, perDayUsd: 1 },
      constitution: { ...DEFAULT_CONSTITUTION },
    },
  },
  {
    id: 'pr-description',
    title: 'PR description writer',
    blurb: 'Drafts a pull-request description from the changed files.',
    form: {
      name: 'PR description writer',
      description: 'Drafts a PR title, summary, test plan and risk notes from a diff.',
      emoji: '🧾',
      role: 'synthesizer',
      systemPrompt:
        'You draft pull-request descriptions. Read the diff or changed files, then produce: a one-line title, a 3–6 line summary of what changed and why, a test plan with exact commands, and risks or follow-ups. Be specific; no filler.',
      tools: ['read_file', 'list_dir'],
      budget: { perRunUsd: 0.25, perDayUsd: 1 },
      constitution: { ...DEFAULT_CONSTITUTION },
    },
  },
];

/* ── Emoji picker ─────────────────────────────────────────────────────── */

export const AGENT_EMOJIS: readonly string[] = [
  '🤖', '🧠', '🔍', '📝', '🧾', '🛠️', '🧪', '📊', '🗂️', '🛡️', '🚀', '🧭',
  '📚', '✍️', '🧮', '🎨', '🐛', '🔧', '📦', '🌐', '🔑', '📣', '🗺️', '⚙️',
  '🧬', '💡', '🧹', '📈', '🧑‍💻', '🕵️', '🗣️', '⏱️',
];

/* ── Chat hand-off ────────────────────────────────────────────────────── */

/** What Chat needs to run a turn "as" an agent (builtin or custom). */
export interface ChatAgentBinding {
  id: string;
  label: string;
  emoji: string;
  systemPrompt: string;
  /** Allowlist of engine tools; empty = engine default set. */
  tools: string[];
  model?: string;
  provider?: string;
  budgetUsd?: number;
  builtin: boolean;
}

export function bindingFor(a: AgentSummary): ChatAgentBinding {
  const c = a.custom;
  const scopeTools = a.toolScope.mode === 'allowlist' ? a.toolScope.tools : [];
  return {
    id: a.id,
    label: a.label,
    emoji: c?.emoji ?? '',
    systemPrompt: c?.systemPrompt ?? `You are ${a.label}. ${a.description}`,
    tools: c ? c.tools : scopeTools,
    ...(a.providerScope.model ? { model: a.providerScope.model } : {}),
    ...(a.providerScope.provider ? { provider: a.providerScope.provider } : {}),
    ...(c ? { budgetUsd: c.budget.perRunUsd } : {}),
    builtin: a.builtin,
  };
}

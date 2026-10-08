/*
 * Engine wire mappers (Phase 14) — PURE. No React, no stores, no toasts.
 *
 * Everything here maps engine shapes onto desktop shapes and is unit-tested
 * from the repo root (`test/desktop/engine-wire.test.ts`), where only the
 * root `bun install` has run — so this module may import nothing that lives
 * in desktop/node_modules. Relative imports only; type imports are erased.
 */
import { modelInfo } from '../budget/models';
import type { ApprovalRequest, ApprovalRisk } from '../lib/approvalCore';
import type { ToolCallRecord } from '../lib/chat-db';
import type { EngineApprovalRequired, EnginePreview } from './types';

const TOOL_META: Record<string, { action: string; icon: string }> = {
  write_file: { action: 'Write a file', icon: 'file-edit' },
  edit_file: { action: 'Edit a file', icon: 'file-edit' },
  patch: { action: 'Apply a diff', icon: 'file-edit' },
  create_file: { action: 'Create a file', icon: 'file-edit' },
  mkdir: { action: 'Create a folder', icon: 'file' },
  rename_file: { action: 'Rename a file', icon: 'file' },
  serve_static: { action: 'Serve a folder locally', icon: 'globe' },
  delete_file: { action: 'Delete a file', icon: 'file' },
  delete: { action: 'Delete', icon: 'file' },
  shell: { action: 'Run a shell command', icon: 'terminal' },
  run_command: { action: 'Run a shell command', icon: 'terminal' },
  exec: { action: 'Run a shell command', icon: 'terminal' },
  send: { action: 'Send a message', icon: 'mail' },
  send_email: { action: 'Send an email', icon: 'mail' },
  http_request: { action: 'Call a web endpoint', icon: 'globe' },
  fetch_url: { action: 'Fetch a URL', icon: 'globe' },
  // Phase 19: workflow human nodes park as approval records.
  'workflow.human_approval': { action: 'Approve a workflow step', icon: 'workflow' },
  'workflow.human_review': { action: 'Review a workflow step', icon: 'workflow' },
  browser: { action: 'Drive the browser', icon: 'globe' },
};

function humanize(tool: string): string {
  const words = tool.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Run a tool';
}

/** Engine tiers → the modal's scale. Unknown tiers are treated as medium. */
export function riskFromTier(tier: string | undefined): ApprovalRisk {
  const t = (tier ?? '').toLowerCase();
  if (t === 'tier0' || t === 'low' || t === 'read' || t === 'safe') return 'low';
  if (t === 'tier2' || t === 'tier3' || t === 'high' || t === 'critical' || t === 'destructive') return 'high';
  return 'medium';
}

function previewText(preview: EnginePreview | string | null | undefined): string | undefined {
  if (!preview) return undefined;
  if (typeof preview === 'string') return preview.slice(0, 4000);
  const parts = (preview.sections ?? []).map((s) =>
    s.title ? `${s.title}\n${s.body}${s.truncated ? '\n…' : ''}` : s.body,
  );
  const text = parts.join('\n\n').trim();
  return text ? text.slice(0, 4000) : undefined;
}

/**
 * The resource a remembered rule keys on. `scope` wins when present: the
 * Builder (Phase 17) names the project there so "Always allow · Write a
 * file · my-app (Builder)" is one rule per project, not one per path — the
 * exact path and diff stay in the preview the human reads.
 */
function resourceOf(a: EngineApprovalRequired): string | null {
  const args = a.args ?? {};
  for (const k of ['scope', 'path', 'file', 'command', 'cmd', 'to', 'url', 'target', 'node']) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  }
  if (a.preview && typeof a.preview !== 'string') {
    const p = a.preview.sections?.find((s) => /^(path|command|target|url)$/i.test(s.title));
    if (p?.body) return p.body.length > 160 ? `${p.body.slice(0, 160)}…` : p.body;
  }
  return null;
}

/** Engine request → the desktop's `ApprovalRequest` (same id). */
export function toApprovalRequest(
  a: EngineApprovalRequired,
  createdAt: number = Date.now(),
): ApprovalRequest {
  const meta = TOOL_META[a.tool] ?? { action: humanize(a.tool), icon: 'wrench' };
  const tier = a.riskTier ?? (typeof a.preview === 'object' && a.preview ? a.preview.riskTier : undefined);
  return {
    id: a.id,
    skillId: a.tool,
    skillName: a.tool,
    skillVersion: 'engine',
    skillIcon: meta.icon,
    action: meta.action,
    resource: resourceOf(a),
    bodyPreview: previewText(a.preview),
    risk: riskFromTier(tier),
    // The reason is model-shaped text — the engine marks it untrusted; the
    // modal renders it as a quote, never as instructions.
    justification: a.reason || `${a.tool} needs your approval`,
    createdAt,
  };
}

/** Provider ids the engine knows (`GET /api/v1/providers`). */
const ENGINE_PROVIDERS = new Set([
  'ollama', 'lmstudio', 'llamacpp', 'jan', 'localai', 'vllm', 'gpt4all', 'koboldcpp',
  'textgenwebui', 'sglang', 'groq', 'deepseek', 'openrouter', 'together', 'fireworks',
  'sambanova', 'xai', 'perplexity', 'huggingface', 'cerebras', 'anthropic', 'google',
  'mistral', 'cohere', 'bedrock', 'openai',
]);

/**
 * Desktop model id → engine `{provider, model}`. Accepts the registry's bare
 * ids (`claude-sonnet-4.5` → anthropic), Ollama tags (`qwen2.5:0.5b`) and an
 * explicit `provider/model` prefix. Unknown → model only (engine default
 * provider decides).
 */
export function resolveEngineModel(id: string): { provider?: string; model?: string } {
  const trimmed = id.trim();
  if (!trimmed) return {};
  const slash = trimmed.indexOf('/');
  if (slash > 0 && ENGINE_PROVIDERS.has(trimmed.slice(0, slash))) {
    return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
  }
  const info = modelInfo(trimmed);
  const provider = info.provider === 'other' ? undefined : info.provider;
  return provider ? { provider, model: trimmed } : { model: trimmed };
}

/** Human summary + category for a tool card, from the engine's call. */
export function describeTool(tool: string, args: Record<string, unknown> | undefined): {
  summary: string;
  category: ToolCallRecord['category'];
} {
  const a = args ?? {};
  const str = (k: string): string | null => {
    const v = a[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const clip = (s: string, n = 72): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const t = tool.toLowerCase();
  if (/^(write_file|edit_file|read_file|delete_file|delete|list_dir|list_files|mkdir|move_file|copy_file|append_file|glob|grep|search_files)$/.test(t)) {
    const target = str('path') ?? str('file') ?? str('dir') ?? str('pattern');
    return { summary: target ? `${tool} ${clip(target)}` : tool, category: 'file' };
  }
  if (/^(shell|run_command|exec|bash|terminal|run)$/.test(t)) {
    const cmd = str('command') ?? str('cmd') ?? str('script');
    return { summary: cmd ? `$ ${clip(cmd)}` : tool, category: 'shell' };
  }
  if (/^(http_request|fetch_url|fetch|web_search|search|browser|browse|download)$/.test(t)) {
    const target = str('url') ?? str('query') ?? str('q');
    return { summary: target ? `${tool} ${clip(target)}` : tool, category: 'network' };
  }
  if (/^(send|send_email|send_message|email)$/.test(t)) {
    const to = str('to') ?? str('recipient');
    return { summary: to ? `${tool} → ${clip(to)}` : tool, category: 'tool' };
  }
  const first = Object.entries(a).find(([, v]) => typeof v === 'string' && (v as string).trim());
  return {
    summary: first ? `${tool} ${clip(first[1] as string)}` : tool,
    category: 'tool',
  };
}

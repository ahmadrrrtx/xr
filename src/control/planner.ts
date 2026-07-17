/**
 * XR v0.8.1 — Multi-step planner.
 *
 *   Natural-language task  →  validated Action[]
 *
 * Uses any XR Provider (local Ollama, Groq, OpenAI, …). The model receives
 * a tight system prompt that locks output to JSON-only and lists the exact
 * Action schema it must obey. The result is parsed, repaired if needed, and
 * validated with the same Zod schema the executor uses — so a bad/jailbroken
 * plan cannot smuggle an unknown action through the safety pipeline.
 *
 * Planner DOES NOT execute. It only proposes. service.ts decides what runs.
 */

import type { Provider, Message } from "../core/types.ts";
import { ActionSchema, type Action, type Plan } from "./types.ts";
import type { Store } from "../state/workspace-store.ts";
import { recallPlan } from "./memory.ts";

const SYSTEM_PROMPT = `You are XR's Computer-Control Planner.

Reply with ONLY JSON: { "rationale": "...", "actions": [ ... ] }

Actions available:
{ "type": "app", "name": "Visual Studio Code" }
{ "type": "close", "name": "Safari" }
{ "type": "focus", "name": "Chrome" }
{ "type": "open", "target": "https://example.com" }
{ "type": "type", "text": "hello" }
{ "type": "click", "x": 640, "y": 480, "button":"left" }
{ "type": "drag_drop", "x1":100,"y1":100,"x2":400,"y2":400 }
{ "type": "scroll", "direction":"down", "amount":3 }
{ "type": "key", "keys": ["cmd","tab"] }
{ "type": "wait_ms", "ms": 500 }
{ "type":"browser","op":"goto","value":"https://github.com" }
{ "type":"browser","op":"click","selector":"text=Sign in" }
{ "type":"browser","op":"fill","selector":"input[name=email]","value":"me@x.com" }
{ "type":"browser","op":"type","selector":"input","value":"hello" }
{ "type":"browser","op":"press","value":"Enter" }
{ "type":"browser","op":"wait","selector":".dashboard" }
{ "type":"browser","op":"extract","selector":"h1" }
{ "type":"browser","op":"screenshot" }
{ "type":"browser","op":"upload","selector":"input[type=file]","value":"/Users/me/file.png" }
{ "type":"browser","op":"new_tab" }
{ "type":"file","op":"read","path":"~/notes.txt" }
{ "type":"file","op":"write","path":"~/out.txt","content":"hello" }
{ "type":"file","op":"list","path":"~/" }
{ "type":"editor","op":"open","editor":"code","file":"~/project/src/index.ts","line":42 }
{ "type":"screenshot","target":"screen" }
{ "type":"system","op":"notify","title":"XR","value":"done" }
{ "type":"system","op":"clipboard_write","value":"copied text" }

Rules: max 12 actions. Never type shell commands (sudo, rm, curl|bash). Prefer browser actions over coordinate clicks. Sensitive values: "sensitive":true. Empty actions if unsafe.`;
interface PlanOptions {
  /** Hard cap on actions (defaults to 10). */
  maxActions?: number;
  /** Store handle for memory recall. Omit to skip memory entirely. */
  store?: Store;
  /** If true, skip memory recall even when a store is provided. */
  noMemory?: boolean;
}

/** Source of the returned plan — useful for cost tracking and UX. */
export type PlanSource = "memory" | "llm";

/** Find the first {...} block in a model reply — tolerant of code fences. */
function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/** Parse → validate → trim. Never throws; returns errors structurally. */
function parsePlan(raw: string, task: string, maxActions: number): { plan: Plan } | { error: string } {
  const block = extractJson(raw);
  if (!block) return { error: "planner did not return JSON" };

  let obj: any;
  try { obj = JSON.parse(block); } catch (e) {
    return { error: `planner JSON invalid: ${(e as Error).message}` };
  }

  const rationale = typeof obj.rationale === "string" ? obj.rationale.slice(0, 500) : undefined;
  const rawActions = Array.isArray(obj.actions) ? obj.actions.slice(0, maxActions) : [];

  const actions: Action[] = [];
  for (let i = 0; i < rawActions.length; i++) {
    const result = ActionSchema.safeParse(rawActions[i]);
    if (!result.success) {
      return { error: `action #${i + 1} is invalid: ${result.error.issues.map((x) => x.message).join("; ")}` };
    }
    actions.push(result.data);
  }

  return { plan: { task, actions, rationale } };
}

/**
 * Produce a Plan from a natural-language task.
 *
 * Order of operations:
 *   1. If `opts.store` is provided and `opts.noMemory` is not set, ask the
 *      memory cache. A hit returns immediately with `source = "memory"` —
 *      zero LLM cost, deterministic, still subject to safety re-validation
 *      inside recallPlan().
 *   2. Otherwise call the provider with a JSON-only prompt, validate the
 *      returned actions, and return `source = "llm"`.
 *
 * The planner NEVER executes — service.ts decides what runs.
 */
export async function planActions(
  provider: Provider,
  task: string,
  opts: PlanOptions = {},
): Promise<{ plan: Plan; source: PlanSource } | { error: string }> {
  // 1. Memory recall (cheap, deterministic).
  if (opts.store && !opts.noMemory) {
    const hit = recallPlan(opts.store, task);
    if (hit) {
      return {
        plan: {
          task: hit.task,
          actions: hit.actions,
          rationale: `recalled from memory (${hit.hits} hit${hit.hits === 1 ? "" : "s"}, ${hit.actions.length} step${hit.actions.length === 1 ? "" : "s"})`,
        },
        source: "memory",
      };
    }
  }

  // 2. LLM fallback.
  const maxActions = Math.max(1, Math.min(20, opts.maxActions ?? 10));
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Task: ${task}\n\nReturn the JSON plan now.` },
  ];

  let turn;
  try {
    turn = await provider.chat(messages, []);
  } catch (e) {
    return { error: `planner provider error: ${(e as Error).message}` };
  }

  const parsed = parsePlan(turn.message ?? "", task, maxActions);
  if ("error" in parsed) return parsed;
  return { plan: parsed.plan, source: "llm" };
}

/** Exposed for tests + dashboard preview. */
export function _internal_parsePlan(raw: string, task: string, maxActions = 10) {
  return parsePlan(raw, task, maxActions);
}

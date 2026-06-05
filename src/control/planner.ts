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

const SYSTEM_PROMPT = `You are XR's Computer-Control Planner.

Your job: convert ONE natural-language task into a short JSON plan of
deterministic, safe-by-construction actions for the user's machine.

REPLY WITH ONLY a single JSON object — no markdown, no prose, no fences:

{
  "rationale": "one short sentence explaining the plan",
  "actions": [ { ...Action }, { ...Action } ]
}

Each Action is one of (use EXACTLY these shapes):

  { "type": "app",    "name": "Visual Studio Code" }
  { "type": "open",   "target": "https://example.com" }       // URL or local path
  { "type": "type",   "text": "hello",  "sensitive": false }  // typed into focused window
  { "type": "click",  "x": 640, "y": 480, "button": "left" }  // COORDS REQUIRED
  { "type": "move",   "x": 640, "y": 480 }
  { "type": "scroll", "direction": "down", "amount": 3 }
  { "type": "key",    "keys": ["cmd","tab"] }                 // any combo
  { "type": "focus",  "name": "Chrome" }

For web work, PREFER the browser variant (selectors are deterministic):

  { "type": "browser", "op": "goto",   "value": "https://github.com" }
  { "type": "browser", "op": "click",  "selector": "text=Sign in" }
  { "type": "browser", "op": "fill",   "selector": "input[name=email]", "value": "me@x.com" }
  { "type": "browser", "op": "fill",   "selector": "input[type=password]", "value": "...", "sensitive": true }
  { "type": "browser", "op": "wait",   "selector": ".dashboard", "timeoutMs": 8000 }
  { "type": "browser", "op": "extract","selector": "h1" }
  { "type": "browser", "op": "submit", "selector": "form#login" }
  { "type": "browser", "op": "close" }

HARD RULES (never break):
  • Maximum 10 actions per plan. Prefer 3–6.
  • NEVER produce shell-like text in a "type" action (no "sudo", "rm", "curl|bash").
  • NEVER produce coordinate clicks for tasks the browser can do.
  • If the task is ambiguous, prefer the minimum plan that makes progress.
  • If the task requires data you don't have (passwords, codes), emit a "fill"
    with sensitive=true and a placeholder value — the user will be prompted.
  • If the task cannot be done safely, return {"rationale":"...","actions":[]}.

Output JSON now.`;

interface PlanOptions {
  /** Hard cap on actions (defaults to 10). */
  maxActions?: number;
}

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
 * Uses provider.chat() with NO tools — the model just emits JSON. We treat
 * any non-conforming output as a planner error (caller decides what to do).
 */
export async function planActions(
  provider: Provider,
  task: string,
  opts: PlanOptions = {},
): Promise<{ plan: Plan } | { error: string }> {
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

  return parsePlan(turn.message ?? "", task, maxActions);
}

/** Exposed for tests + dashboard preview. */
export function _internal_parsePlan(raw: string, task: string, maxActions = 10) {
  return parsePlan(raw, task, maxActions);
}

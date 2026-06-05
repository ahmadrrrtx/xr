/**
 * XR — structured LLM helper for research.
 *
 * Research needs the model to return STRUCTURED JSON (plans, notes, synthesis),
 * not tool-calling chat turns. Rather than abuse the agent loop, we make a
 * single, tools-free structured call through the same Provider abstraction and
 * reuse XR's deterministic JSON repair (validation sandwich).
 *
 * Cost accounting: every call records token usage back to the caller via the
 * onUsage hook, so research spend is always visible (security rule: never
 * silently spend budget).
 */
import type { Message, Provider } from "../core/types.ts";
import { repairToTurn } from "../reliability/repair.ts";

export interface StructuredCallDeps {
  provider: Provider;
  /** Called with token usage after each model call, for budget accounting. */
  onUsage?: (inTokens: number, outTokens: number) => void;
}

/**
 * Ask the model for a single JSON object. Returns the parsed object (best-effort
 * repaired) plus the raw message. No tools are exposed, so the provider's
 * envelope still asks for JSON and we extract the payload from `message`.
 *
 * We pass an empty tool list; the existing providers then expect a JSON envelope
 * `{message, tool_calls, done}` — we instruct the model to put its JSON answer
 * inside `message` as a fenced/plain object, and we repair that out.
 */
export async function structuredCall<T = unknown>(
  deps: StructuredCallDeps,
  system: string,
  user: string,
): Promise<{ data: T | null; raw: string }> {
  // IMPORTANT: providers (e.g. OpenAICompatProvider) inject their OWN system
  // envelope that asks for a {message, tool_calls, done} object. To stay robust
  // across every provider, we put the research instructions + payload in a
  // single USER message (not a competing system message). The model then writes
  // its JSON answer into the envelope's `message`, which repairToTurn surfaces
  // as turn.message and we parse out below.
  const messages: Message[] = [
    {
      role: "user",
      content: `${system}\n\n---\n${user}\n\n---\nReturn ONLY the requested JSON object as your message.`,
    },
  ];

  const turn = await deps.provider.chat(messages, []);
  if (turn.usage && deps.onUsage) deps.onUsage(turn.usage.inTokens, turn.usage.outTokens);

  const raw = turn.message ?? "";
  const data = extractJson<T>(raw);
  return { data, raw };
}

/** Pull the first JSON object/array out of arbitrary model text. */
export function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  // Try a direct parse first.
  const direct = safeParse<T>(raw.trim());
  if (direct !== null) return direct;

  // Strip fences and isolate the outermost { } or [ ].
  let s = raw.replace(/```(?:json)?/gi, "").trim();
  const objStart = s.indexOf("{");
  const arrStart = s.indexOf("[");
  let start = -1;
  let end = -1;
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    start = arrStart;
    end = s.lastIndexOf("]");
  } else if (objStart !== -1) {
    start = objStart;
    end = s.lastIndexOf("}");
  }
  if (start === -1 || end === -1 || end < start) return null;
  s = s.slice(start, end + 1);

  return safeParse<T>(s) ?? safeParse<T>(lightFix(s));
}

function safeParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function lightFix(s: string): string {
  return s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/'([^']*)'(\s*:)/g, '"$1"$2');
}

// Re-export for callers/tests.
export { repairToTurn };

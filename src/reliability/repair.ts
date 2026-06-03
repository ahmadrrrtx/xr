/**
 * XR — auto-repair for model output.
 *
 * Even with grammar (cloud providers without grammar support, or edge cases),
 * we run a deterministic repair pass so a malformed reply never reaches a tool.
 * (TRD §3.2 "validation sandwich": grammar → repair → schema.)
 */
import type { ModelTurn, ToolCall } from "../core/types.ts";

/** Strip markdown fences, isolate the first JSON object, repair common errors. */
export function repairToTurn(raw: string): ModelTurn {
  const fallback: ModelTurn = {
    message: (raw ?? "").trim() || "(no response)",
    toolCalls: [],
    done: true,
  };
  if (!raw) return fallback;

  let s = raw.trim();
  // 1. Strip code fences.
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  // 2. Isolate the outermost {...}.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return fallback;
  s = s.slice(start, end + 1);

  // 3. Try strict parse, then progressively-repaired parses.
  const obj = tryParse(s) ?? tryParse(lightFix(s));
  if (!obj || typeof obj !== "object") return fallback;

  const toolCalls: ToolCall[] = Array.isArray((obj as any).tool_calls)
    ? (obj as any).tool_calls
        .filter((c: any) => c && typeof c.tool === "string")
        .map((c: any) => ({ tool: c.tool, args: isObj(c.args) ? c.args : {} }))
    : [];

  return {
    message: typeof (obj as any).message === "string" ? (obj as any).message : "",
    toolCalls,
    done: Boolean((obj as any).done) || toolCalls.length === 0,
  };
}

function tryParse(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Common, safe repairs: trailing commas, smart quotes, single quotes. */
function lightFix(s: string): string {
  return s
    .replace(/[\u201C\u201D]/g, '"') // smart double quotes
    .replace(/[\u2018\u2019]/g, "'") // smart single quotes
    .replace(/,\s*([}\]])/g, "$1") // trailing commas
    .replace(/'([^']*)'(\s*:)/g, '"$1"$2'); // single-quoted keys
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

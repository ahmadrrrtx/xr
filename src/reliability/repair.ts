/**
 * XR — auto-repair for model output.
 *
 * Even with grammar (cloud providers without grammar support, or edge cases),
 * we run a deterministic repair pass so a malformed reply never reaches a tool.
 * (TRD §3.2 "validation sandwich": grammar → repair → schema.)
 *
 * Phase 1 · Turn Contract (F-02/M-02/M-06): `repairToTurn` is status-carrying.
 * It NEVER fabricates a completion. An empty or undecodable payload is reported
 * as `status: "empty"`/`"undecodable"` with `done: false` — the agent loop then
 * ends `stopped:"error"` (audited `turn.empty`/`turn.undecodable`) instead of
 * silently reporting a fake "done". `done:true` is only ever set from a
 * model-declared `done:true`, never coerced from an empty tool-call list.
 */
import type { ModelTurn, ToolCall } from "../core/types.ts";

/** Classification of a raw model reply by the repair pass. */
export type RepairStatus = "parsed" | "empty" | "undecodable";

/** Strip markdown fences, isolate the first JSON object, repair common errors. */
export function repairToTurn(raw: string): ModelTurn {
  if (!raw || !raw.trim()) {
    // Empty/no content is NOT a completion. Honest, audited empty turn.
    return { message: "", toolCalls: [], done: false, status: "empty" };
  }

  let s = raw.trim();
  // 1. Strip code fences.
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  // 2. Isolate the outermost {...}.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    // No JSON object at all. If the model answered plainly, keep the text as
    // content (never discard it) but mark it undecodable and non-done so the
    // loop can decide honestly (envelope mode expects JSON ⇒ will error).
    return { message: s, toolCalls: [], done: false, status: "undecodable" };
  }
  s = s.slice(start, end + 1);

  // 3. Try strict parse, then progressively-repaired parses.
  const obj = tryParse(s) ?? tryParse(lightFix(s));
  if (!obj || typeof obj !== "object") {
    // Not decodable even after repair ⇒ undecodable, never done.
    return { message: raw.trim(), toolCalls: [], done: false, status: "undecodable" };
  }

  const toolCalls: ToolCall[] = Array.isArray((obj as any).tool_calls)
    ? (obj as any).tool_calls
        .filter((c: any) => c && typeof c.tool === "string")
        .map((c: any) => ({ tool: c.tool, args: isObj(c.args) ? c.args : {} }))
    : [];

  const declaredDone = typeof (obj as any).done === "boolean" ? Boolean((obj as any).done) : false;
  const message =
    typeof (obj as any).message === "string" ? (obj as any).message : "";

  // Phase 1 — an object is ONLY treated as a decoded turn ("parsed") when it is
  // actually ENVELOPE-SHAPED (carries message/tool_calls/done). A plain answer
  // that happens to contain some other JSON (e.g. a reviewer quoting
  // {"decision":"approved"}) is NOT an envelope — it stays "undecodable" and its
  // text is preserved so the transport's completion signal (finish/done) is kept
  // authoritative instead of being overwritten by a spurious done:false.
  const isEnvelopeShape =
    "message" in (obj as any) || "tool_calls" in (obj as any) || "done" in (obj as any);

  return {
    message,
    toolCalls,
    // done ONLY from the model's explicit declaration (never from empty tool calls).
    done: declaredDone,
    status: isEnvelopeShape ? "parsed" : "undecodable",
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

/**
 * XR — fail-closed reviewer decision parsing (Phase 0 · T10).
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * `MultiAgentService.inferReviewState` pattern-matched free text and ended with:
 *
 *     return "approved";
 *
 * So a reviewer that returned an empty string, a refusal, a stack trace, a
 * timeout message, or any text the regexes did not recognise was recorded as
 * APPROVED. The safety gate failed OPEN: the least trustworthy input produced
 * the most permissive outcome.
 *
 * That also made the gate trivially manipulable — a model (or an injected
 * instruction inside reviewed content) needed only to avoid the rejection
 * keywords to obtain approval.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 *
 * Reviewers MUST emit strict JSON:
 *
 *     { "decision": "approved" | "changes_requested" | "rejected",
 *       "reason": "…" }
 *
 * Anything else — malformed JSON, a missing field, an unknown decision value,
 * empty output, or prose without a JSON object — resolves to
 * `changes_requested`, never `approved` (Commandment 13; Article IX).
 *
 * Approval is the only outcome that requires an explicit, well-formed,
 * unambiguous statement.
 */

import type { ReviewState } from "../agents/types.ts";

export interface ReviewDecision {
  decision: ReviewState;
  reason: string;
  /** How the decision was reached — useful for audit and debugging. */
  source: "strict_json" | "fenced_json" | "parse_failure" | "ambiguous" | "empty";
}

const VALID_DECISIONS = new Set<string>(["approved", "changes_requested", "rejected"]);

/** The safe outcome for anything we cannot positively verify. */
function failClosed(reason: string, source: ReviewDecision["source"]): ReviewDecision {
  return { decision: "changes_requested", reason, source };
}

/** Extract the first balanced JSON object starting at or after `from`. */
function extractJsonObject(text: string, from = 0): { json: string; end: number } | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

/**
 * Parse a reviewer's output into a decision, failing closed on any doubt.
 */
export function parseReviewDecision(raw: unknown): ReviewDecision {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return failClosed("reviewer produced no output", "empty");
  }

  const text = raw.trim();

  // Strip a Markdown code fence if the model wrapped its JSON in one.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateSource: ReviewDecision["source"] = fenced ? "fenced_json" : "strict_json";
  const body = fenced?.[1]?.trim() ?? text;

  // A reviewer that precedes its decision with findings may emit braces inside
  // prose (code snippets, examples). Accept the FIRST well-formed JSON object
  // that actually carries a string `decision` field rather than blindly taking
  // the first balanced object: that is the decision the reviewer marked. If no
  // object qualifies we fail closed, unchanged.
  let parsed: unknown = null;
  let cursor = 0;
  let found = false;
  while (cursor < body.length && !found) {
    const extracted = extractJsonObject(body, cursor);
    if (!extracted) break;
    cursor = extracted.end;
    let candidate: unknown;
    try {
      candidate = JSON.parse(extracted.json);
    } catch {
      continue; // not JSON — keep scanning
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      typeof (candidate as Record<string, unknown>).decision === "string"
    ) {
      parsed = candidate;
      found = true;
    }
  }

  if (!found) {
    return failClosed(
      "reviewer output contained no JSON decision object; expected {\"decision\":…,\"reason\":…}",
      "parse_failure",
    );
  }

  const record = parsed as Record<string, unknown>;
  const decisionRaw = record.decision;

  if (typeof decisionRaw !== "string") {
    return failClosed("reviewer decision field is missing or not a string", "parse_failure");
  }

  const decision = decisionRaw.trim().toLowerCase();
  if (!VALID_DECISIONS.has(decision)) {
    return failClosed(`reviewer returned an unrecognised decision "${decisionRaw}"`, "ambiguous");
  }

  const reasonRaw = record.reason;
  const reason = typeof reasonRaw === "string" && reasonRaw.trim().length > 0
    ? reasonRaw.trim()
    : "(no reason supplied)";

  // An approval with no stated reason is treated as unverified: the whole point
  // of the contract is that approval must be an explicit, justified act.
  if (decision === "approved" && (typeof reasonRaw !== "string" || reasonRaw.trim().length === 0)) {
    return failClosed("reviewer approved without stating a reason", "ambiguous");
  }

  return { decision: decision as ReviewState, reason, source: candidateSource };
}

/** The instruction block reviewers receive, so the contract is enforceable. */
export const REVIEW_OUTPUT_CONTRACT = [
  "You MUST end your response with a single JSON object and nothing after it:",
  '{"decision":"approved|changes_requested|rejected","reason":"<one sentence>"}',
  "",
  "Rules:",
  "- `approved` requires a non-empty reason.",
  "- If you are uncertain, or cannot complete the review, use `changes_requested`.",
  "- Any output that is not valid JSON is treated as `changes_requested`.",
].join("\n");

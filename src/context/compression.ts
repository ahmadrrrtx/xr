/**
 * XR 4.5 — Evidence-preserving compression (§7.8 / §9.6 / §11.4).
 *
 * The rule that makes this different from ordinary summarization:
 *
 *   Compression must FAIL SAFE. If a required invariant cannot be preserved,
 *   we do not produce a lossy summary and hope — we return `ok:false` and the
 *   caller keeps the originals.
 *
 * Everything here is deterministic (no model call), so:
 *   • speculation can never become fact through paraphrase;
 *   • the same input always yields the same summary;
 *   • the result is testable line by line.
 *
 * Model assistance is deliberately NOT wired in here. §7.8 permits it "governed
 * by Phase 5 and durable execution", but a model rewrite cannot offer the
 * fail-safe guarantee above, so v1 ships deterministic-only and says so.
 */

import {
  CONTEXT_BOUNDS,
  boundText,
  type CompressionResult,
  type ContextItem,
  type PreservedInvariant,
} from "./types.ts";

// ── Extraction patterns ────────────────────────────────────────────────────

/** Sentences that record a decision. */
const DECISION_RE =
  /\b(decided|decision|chose|chosen|selected|agreed|approved|rejected|will use|we use|must use|standard is|policy is|switched to|migrated to)\b/i;

/** Sentences that record an unresolved question. */
const QUESTION_RE = /\b(open question|unresolved|unclear|tbd|to be decided|needs? (a )?decision|pending|blocked on|waiting on|unknown whether)\b|\?$/i;

/** Sentences expressing uncertainty. Preserved verbatim so hedges survive. */
const UNCERTAINTY_RE =
  /\b(maybe|might|may|possibly|probably|likely|unlikely|appears|seems|suggests|assume[sd]?|estimate[sd]?|approximately|roughly|not sure|uncertain|unverified|unconfirmed)\b/i;

/** Sentences recording a user correction. */
const CORRECTION_RE =
  /\b(correction|corrected|actually|not true|that'?s wrong|instead of|revised|updated to|no longer|superseded|replaces?)\b/i;

/** Dates in common formats. */
const DATE_RE =
  /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\b(?:19|20)\d{2}\b)/i;

/** Actor mentions. */
const ACTOR_RE = /\b(user|operator|admin|agent|xr|team|client|customer|reviewer|author|owner)\b/i;

/** Source-ish references. */
const SOURCE_RE = /(https?:\/\/\S+|\b[\w.-]+\.(?:ts|tsx|js|py|go|rs|md|json|yaml|yml|toml|sql|txt)\b|\bdoi:\S+|\bsee\s+\S+)/i;

/** Scope/permission statements. */
const SCOPE_RE =
  /\b(scope[sd]?|permission|allowed|denied|restricted|only in|limited to|workspace|project|read-only|write access|requires approval)\b/i;

// ── Input ──────────────────────────────────────────────────────────────────

export interface CompressionInput {
  /** Items to fold. */
  items: readonly ContextItem[];
  /** Human-readable identity of the task the summary belongs to. */
  taskIdentity: string;
  /** Character budget for the resulting summary. */
  maxChars?: number;
  /** Invariants that MUST be preserved. Defaults to the full §9.6 set. */
  required?: readonly PreservedInvariant[];
  /** Lineage: generation of the parent (0 when folding originals). */
  parentGeneration?: number;
  lineageParent?: string | null;
}

/** The full §9.6 invariant set. */
export const DEFAULT_REQUIRED_INVARIANTS: readonly PreservedInvariant[] = [
  "decisions",
  "sources",
  "dates",
  "actors",
  "unresolved_questions",
  "uncertainty",
  "user_corrections",
  "permissions_scope",
  "task_identity",
  "artifact_references",
];

// ── Compression ────────────────────────────────────────────────────────────

/**
 * Compress a set of context items into a structured, evidence-preserving
 * summary.
 *
 * An invariant counts as "preserved" when it was either (a) not present in the
 * source at all, or (b) present AND carried into the output. It counts as
 * "lost" only when it was present in the source and could not fit or could not
 * be represented — which fails the whole compression.
 */
export function compressItems(input: CompressionInput): CompressionResult {
  const maxChars = input.maxChars ?? 4_000;
  const required = input.required ?? DEFAULT_REQUIRED_INVARIANTS;
  const generation = (input.parentGeneration ?? 0) + 1;
  const sourceItemIds = input.items.map((i) => i.id);
  const originalChars = input.items.reduce((n, i) => n + i.content.length, 0);

  // Refuse to compress beyond the lineage depth — repeated re-summary is where
  // evidence silently dies.
  if (generation > CONTEXT_BOUNDS.maxSummaryGeneration) {
    return {
      ok: false,
      preserved: [],
      lost: [...required],
      sourceItemIds,
      generation,
      lineageParent: input.lineageParent ?? null,
      originalChars,
      compressedChars: 0,
      reason: `refusing to compress past generation ${CONTEXT_BOUNDS.maxSummaryGeneration} — evidence fidelity cannot be guaranteed`,
    };
  }

  if (input.items.length === 0) {
    return {
      ok: false,
      preserved: [],
      lost: [],
      sourceItemIds: [],
      generation,
      lineageParent: input.lineageParent ?? null,
      originalChars: 0,
      compressedChars: 0,
      reason: "nothing to compress",
    };
  }

  // ── 1. Extract what must survive ──────────────────────────────────────
  const found = extractInvariants(input.items, input.taskIdentity);

  // ── 2. Build the structured summary ───────────────────────────────────
  const sections: Array<{ heading: string; lines: string[]; invariant: PreservedInvariant }> = [
    { heading: "Task", lines: [input.taskIdentity], invariant: "task_identity" },
    { heading: "Decisions", lines: found.decisions, invariant: "decisions" },
    { heading: "User corrections", lines: found.corrections, invariant: "user_corrections" },
    { heading: "Unresolved questions", lines: found.questions, invariant: "unresolved_questions" },
    { heading: "Uncertainty", lines: found.uncertainty, invariant: "uncertainty" },
    { heading: "Sources", lines: found.sources, invariant: "sources" },
    { heading: "Artifacts", lines: found.artifacts, invariant: "artifact_references" },
    { heading: "Dates", lines: found.dates, invariant: "dates" },
    { heading: "Actors", lines: found.actors, invariant: "actors" },
    { heading: "Scope and permissions", lines: found.scope, invariant: "permissions_scope" },
  ];

  const preserved: PreservedInvariant[] = [];
  const lost: PreservedInvariant[] = [];
  const out: string[] = [`Context summary (generation ${generation}, folding ${input.items.length} items)`];
  let budget = maxChars - out[0]!.length;

  // Priority order: invariants that carry meaning/safety first, so a tight
  // budget sheds ornamental detail rather than evidence.
  for (const section of sections) {
    if (section.lines.length === 0) {
      // Absent from source → trivially preserved (nothing was dropped).
      if (!found.present.has(section.invariant)) preserved.push(section.invariant);
      else lost.push(section.invariant);
      continue;
    }

    const header = `\n${section.heading}:`;
    const lines = section.lines.map((l) => `  • ${l}`);
    const cost = header.length + lines.reduce((n, l) => n + l.length + 1, 0);

    if (cost <= budget) {
      out.push(header, ...lines);
      budget -= cost;
      preserved.push(section.invariant);
      continue;
    }

    // Partial fit: keep as many lines as the budget allows. An invariant is
    // preserved only if at least one representative line survived AND we record
    // the truncation honestly.
    const kept: string[] = [];
    let spent = header.length;
    for (const l of lines) {
      if (spent + l.length + 1 > budget) break;
      kept.push(l);
      spent += l.length + 1;
    }

    if (kept.length === 0) {
      lost.push(section.invariant);
      continue;
    }

    const omitted = lines.length - kept.length;
    const note = `  • (${omitted} more not shown — see source items)`;
    if (spent + note.length + 1 <= budget) {
      kept.push(note);
      spent += note.length + 1;
    }
    out.push(header, ...kept);
    budget -= spent;

    // Truncating decisions, corrections, questions, uncertainty, or sources is
    // an evidence loss — these are the invariants that must survive whole.
    const MUST_BE_COMPLETE: ReadonlySet<PreservedInvariant> = new Set<PreservedInvariant>([
      "decisions",
      "user_corrections",
      "unresolved_questions",
      "uncertainty",
      "sources",
    ]);
    if (MUST_BE_COMPLETE.has(section.invariant)) lost.push(section.invariant);
    else preserved.push(section.invariant);
  }

  // ── 3. Verify required invariants ─────────────────────────────────────
  const missing = required.filter((inv) => lost.includes(inv));
  if (missing.length > 0) {
    return {
      ok: false,
      preserved,
      lost: missing,
      sourceItemIds,
      generation,
      lineageParent: input.lineageParent ?? null,
      originalChars,
      compressedChars: 0,
      reason: `cannot preserve required evidence: ${missing.join(", ")} — originals retained`,
    };
  }

  const summary = out.join("\n");

  return {
    ok: true,
    summary: boundText(summary, maxChars),
    preserved,
    lost,
    sourceItemIds,
    generation,
    lineageParent: input.lineageParent ?? null,
    originalChars,
    compressedChars: summary.length,
  };
}

// ── Extraction ─────────────────────────────────────────────────────────────

interface Extracted {
  decisions: string[];
  corrections: string[];
  questions: string[];
  uncertainty: string[];
  sources: string[];
  artifacts: string[];
  dates: string[];
  actors: string[];
  scope: string[];
  /** Invariants that were actually present in the source. */
  present: Set<PreservedInvariant>;
}

/** Split content into sentence-ish units without a dependency. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+|(?:^|\s)[•\-*]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function extractInvariants(items: readonly ContextItem[], taskIdentity: string): Extracted {
  const e: Extracted = {
    decisions: [],
    corrections: [],
    questions: [],
    uncertainty: [],
    sources: [],
    artifacts: [],
    dates: [],
    actors: [],
    scope: [],
    present: new Set<PreservedInvariant>(),
  };

  if (taskIdentity.trim()) e.present.add("task_identity");

  const seenSource = new Set<string>();
  const seenDate = new Set<string>();
  const seenActor = new Set<string>();

  for (const item of items) {
    const cite = `[${item.id.slice(0, 12)}]`;

    // Structured signals from the item's own metadata — these are the most
    // reliable and never depend on text matching.
    if (item.uncertainty.openQuestions.length) {
      e.present.add("unresolved_questions");
      for (const q of item.uncertainty.openQuestions) e.questions.push(`${trim(q, 180)} ${cite}`);
    }
    if (item.uncertainty.contradictedBy.length) {
      e.present.add("uncertainty");
      e.uncertainty.push(
        `contradicted by ${item.uncertainty.contradictedBy.length} item(s): ${item.uncertainty.contradictedBy
          .map((x) => x.slice(0, 12))
          .join(", ")} ${cite}`,
      );
    }
    if (item.uncertainty.confidence === "low" || item.uncertainty.confidence === "unknown") {
      e.present.add("uncertainty");
      e.uncertainty.push(`confidence ${item.uncertainty.confidence} ${cite}`);
    }
    if (item.supersededBy) {
      e.present.add("user_corrections");
      e.corrections.push(`superseded by ${item.supersededBy.slice(0, 12)} ${cite}`);
    }
    if (item.provenanceRef) {
      e.present.add("sources");
      const key = item.provenanceRef;
      if (!seenSource.has(key)) {
        seenSource.add(key);
        e.sources.push(`${item.provenanceKind}: ${trim(item.provenanceRef, 160)} ${cite}`);
      }
    }
    if (item.links.artifactId) {
      e.present.add("artifact_references");
      e.artifacts.push(`artifact ${item.links.artifactId} ${cite}`);
    }
    if (item.links.runId) {
      e.present.add("artifact_references");
      e.artifacts.push(`run ${item.links.runId} ${cite}`);
    }
    if (item.links.claimId) {
      e.present.add("sources");
      const key = `claim:${item.links.claimId}`;
      if (!seenSource.has(key)) {
        seenSource.add(key);
        e.sources.push(`research claim ${item.links.claimId} ${cite}`);
      }
    }

    // Scope/permission is always present as metadata.
    e.present.add("permissions_scope");
    const scopeLine = `${item.scope.projectScope} · ${item.type} · ${item.trustStatus} · consent ${item.consentState}`;
    if (!e.scope.includes(scopeLine)) e.scope.push(scopeLine);

    // Dates from metadata are authoritative.
    e.present.add("dates");
    const created = new Date(item.createdAt).toISOString().slice(0, 10);
    if (!seenDate.has(created)) {
      seenDate.add(created);
      e.dates.push(`${created} — ${trim(item.title, 60)}`);
    }

    // Actors from metadata.
    if (item.actorKind !== "unknown") {
      e.present.add("actors");
      const actor = item.actorName ? `${item.actorKind}:${item.actorName}` : item.actorKind;
      if (!seenActor.has(actor)) {
        seenActor.add(actor);
        e.actors.push(actor);
      }
    }

    // Text signals.
    for (const s of sentences(item.content)) {
      if (DECISION_RE.test(s)) {
        e.present.add("decisions");
        e.decisions.push(`${trim(s, 200)} ${cite}`);
      }
      if (CORRECTION_RE.test(s)) {
        e.present.add("user_corrections");
        e.corrections.push(`${trim(s, 200)} ${cite}`);
      }
      if (QUESTION_RE.test(s)) {
        e.present.add("unresolved_questions");
        e.questions.push(`${trim(s, 200)} ${cite}`);
      }
      if (UNCERTAINTY_RE.test(s)) {
        e.present.add("uncertainty");
        // Verbatim (bounded) so hedges are never "cleaned up" into facts.
        e.uncertainty.push(`${trim(s, 200)} ${cite}`);
      }
      const src = s.match(SOURCE_RE);
      if (src?.[1]) {
        e.present.add("sources");
        const key = src[1];
        if (!seenSource.has(key)) {
          seenSource.add(key);
          e.sources.push(`${trim(key, 160)} ${cite}`);
        }
      }
      const d = s.match(DATE_RE);
      if (d?.[1] && !seenDate.has(d[1])) {
        e.present.add("dates");
        seenDate.add(d[1]);
        e.dates.push(`${d[1]} — ${trim(s, 100)}`);
      }
      if (ACTOR_RE.test(s)) e.present.add("actors");
      if (SCOPE_RE.test(s)) e.present.add("permissions_scope");
    }
  }

  // De-duplicate and bound each list.
  const cap = 24;
  e.decisions = unique(e.decisions).slice(0, cap);
  e.corrections = unique(e.corrections).slice(0, cap);
  e.questions = unique(e.questions).slice(0, cap);
  e.uncertainty = unique(e.uncertainty).slice(0, cap);
  e.sources = unique(e.sources).slice(0, cap);
  e.artifacts = unique(e.artifacts).slice(0, cap);
  e.dates = unique(e.dates).slice(0, 12);
  e.actors = unique(e.actors).slice(0, 12);
  e.scope = unique(e.scope).slice(0, 12);

  return e;
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}

function trim(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : one.slice(0, max - 1) + "…";
}

// ── Message compaction (evidence-preserving replacement for compact.ts) ────

export interface MessageLike {
  role: string;
  content: string;
  name?: string;
}

/**
 * Evidence-preserving conversation compaction.
 *
 * Unlike the 4.4 `compact()` (which truncated every older message to 160
 * characters), this keeps sentences that carry decisions, corrections,
 * questions, uncertainty, and sources INTACT, and drops only redundant
 * low-value detail.
 *
 * `compact()` in `src/memory/compact.ts` is preserved unchanged for
 * compatibility; callers opt into this one.
 */
export function compressMessages(
  messages: readonly MessageLike[],
  opts: { maxChars?: number; keepRecent?: number; taskIdentity?: string } = {},
): { messages: MessageLike[]; compressed: boolean; preserved: PreservedInvariant[]; lost: PreservedInvariant[] } {
  const maxChars = opts.maxChars ?? 16_000;
  const keepRecent = opts.keepRecent ?? 6;
  const total = messages.reduce((n, m) => n + m.content.length, 0);

  if (total <= maxChars || messages.length <= keepRecent + 1) {
    return { messages: [...messages], compressed: false, preserved: [], lost: [] };
  }

  const hasSystem = messages[0]?.role === "system";
  const system = hasSystem ? [messages[0]!] : [];
  const rest = hasSystem ? messages.slice(1) : messages;
  const recent = rest.slice(-keepRecent);
  const older = rest.slice(0, -keepRecent);

  const kept: string[] = [];
  const lowValue: string[] = [];

  for (const m of older) {
    const tag = m.role === "tool" ? `tool(${m.name ?? "?"})` : m.role === "assistant" ? "xr" : m.role;
    for (const s of sentences(m.content)) {
      const important =
        DECISION_RE.test(s) ||
        CORRECTION_RE.test(s) ||
        QUESTION_RE.test(s) ||
        UNCERTAINTY_RE.test(s) ||
        SOURCE_RE.test(s) ||
        SCOPE_RE.test(s) ||
        DATE_RE.test(s);
      if (important) kept.push(`- ${tag}: ${trim(s, 400)}`); // generous cap: never cut a negation
      else lowValue.push(`- ${tag}: ${trim(s, 100)}`);
    }
  }

  const preserved: PreservedInvariant[] = [];
  if (kept.some((k) => DECISION_RE.test(k))) preserved.push("decisions");
  if (kept.some((k) => CORRECTION_RE.test(k))) preserved.push("user_corrections");
  if (kept.some((k) => QUESTION_RE.test(k))) preserved.push("unresolved_questions");
  if (kept.some((k) => UNCERTAINTY_RE.test(k))) preserved.push("uncertainty");
  if (kept.some((k) => SOURCE_RE.test(k))) preserved.push("sources");

  const header = `[evidence-preserving summary of ${older.length} earlier messages]`;
  const taskLine = opts.taskIdentity ? `Task: ${opts.taskIdentity}` : "";
  const budget = Math.max(1_000, Math.floor(maxChars * 0.35));

  const body: string[] = [header];
  if (taskLine) body.push(taskLine);
  body.push("Preserved (decisions, corrections, questions, uncertainty, sources):");

  let used = body.join("\n").length;
  const lost: PreservedInvariant[] = [];
  let truncatedImportant = 0;

  for (const line of kept) {
    if (used + line.length + 1 > budget) {
      truncatedImportant++;
      continue;
    }
    body.push(line);
    used += line.length + 1;
  }

  if (truncatedImportant > 0) {
    body.push(`- (${truncatedImportant} further significant statements omitted — full history retained in session records)`);
    // Honest: we truncated evidence, so nothing here is guaranteed complete.
    lost.push("decisions");
  }

  if (lowValue.length) {
    const note = `Condensed: ${lowValue.length} routine statements omitted.`;
    if (used + note.length + 1 <= budget) body.push(note);
  }

  const note: MessageLike = { role: "system", content: body.join("\n") };
  return {
    messages: [...system, note, ...recent],
    compressed: true,
    preserved,
    lost,
  };
}

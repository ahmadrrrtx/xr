/**
 * XR — citation-aware research report rendering + export.
 *
 * Renders a ResearchSession into a clean, structured Markdown report and,
 * optionally, a machine-readable JSON sidecar. The Markdown is signed with a
 * SHA-256 over its body (same pattern as the audit export) so a shared report
 * can be checked for tampering.
 *
 * Transparency requirements honored here:
 *   - every source is listed with url, domain, trust, and whether it was fetched
 *   - notes carry their epistemic tag and a "verified/unverified" marker
 *   - contradictions and open questions are surfaced, not hidden
 */
import { createHash } from "node:crypto";
import type { ResearchSession, Source, Note } from "./types.ts";

export interface RenderedReport {
  markdown: string;
  sha256: string;
}

function confBadge(c: string): string {
  return c === "high" ? "🟢 high" : c === "medium" ? "🟡 medium" : "🔴 low";
}

function trustBadge(trust: number): string {
  if (trust >= 0.8) return "🟢";
  if (trust >= 0.55) return "🟡";
  return "🔴";
}

/** Build the full Markdown report for a session. */
export function renderReport(session: ResearchSession): RenderedReport {
  const L: string[] = [];
  const s = session;

  L.push(`# Research Report — ${s.topic}`);
  L.push("");
  L.push(`- Generated: ${new Date(s.updatedAt).toISOString()}`);
  L.push(`- Mode: ${s.mode ?? s.depth} (${s.depth})`);
  L.push(`- Session: ${s.id}`);
  if (s.synthesis) L.push(`- Overall confidence: ${confBadge(s.synthesis.overallConfidence)}`);
  L.push(`- Sources collected: ${s.sources.length} (fetched: ${s.sources.filter((x) => x.fetched).length})`);
  L.push(`- Evidence notes: ${s.notes.length} (verified: ${s.notes.filter((n) => n.verified).length})`);
  L.push(`- Claims tracked: ${s.claims?.length ?? 0}`);
  L.push(`- Contradictions: ${s.contradictions.length}`);
  if (s.lastRefreshedAt) L.push(`- Last refreshed: ${new Date(s.lastRefreshedAt).toISOString()}`);
  if (s.meter) L.push(`- Spend: ${stripAnsi(s.meter)}`);
  L.push("");

  // ── Short answer ──────────────────────────────────────────────────────────
  if (s.synthesis) {
    L.push(`## Short answer`);
    L.push("");
    L.push(s.synthesis.shortAnswer);
    L.push("");

    L.push(`## Executive summary`);
    L.push("");
    if (s.synthesis.executiveSummary.length) {
      for (const b of s.synthesis.executiveSummary) L.push(`- ${b}`);
    } else {
      L.push(`_No summary available._`);
    }
    L.push("");

    L.push(`## Full report`);
    L.push("");
    L.push(s.synthesis.report);
    L.push("");
  }

  // ── Comparison matrix ─────────────────────────────────────────────────────
  if (s.comparison) {
    L.push(`## Comparison matrix`);
    L.push("");
    L.push(`**Verdict:** ${s.comparison.verdict}`);
    L.push("");
    L.push(`| criterion | ${s.comparison.subjects.map(escapePipe).join(" | ")} |`);
    L.push(`|---|${s.comparison.subjects.map(() => "---").join("|")}|`);
    for (const row of s.comparison.matrix) {
      L.push(`| ${escapePipe(row.criterion ?? "")} | ${s.comparison.subjects.map((subject) => escapePipe(row[subject] ?? "")).join(" | ")} |`);
    }
    L.push("");
  }

  // ── Contradictions ────────────────────────────────────────────────────────
  if (s.contradictions.length) {
    L.push(`## ⚠️ Contradictions & disagreements`);
    L.push("");
    for (const c of s.contradictions) {
      const refs = c.sourceIds.length ? ` (${c.sourceIds.map((id) => `[${id}]`).join(" vs ")})` : "";
      L.push(`- **${c.topic}**${refs}: ${c.description}`);
    }
    L.push("");
  }

  // ── Open questions ────────────────────────────────────────────────────────
  if (s.synthesis?.openQuestions.length) {
    L.push(`## Open questions & uncertainty`);
    L.push("");
    for (const q of s.synthesis.openQuestions) L.push(`- ${q}`);
    L.push("");
  }

  // ── Claims ────────────────────────────────────────────────────────────────
  if (s.claims?.length) {
    L.push(`## Claim ledger`);
    L.push("");
    for (const cl of s.claims) {
      const refs = cl.sourceIds.map((id) => `[${id}]`).join("");
      L.push(`- **${cl.status}** (${cl.kind}/${cl.confidence}) ${cl.text} ${refs}`);
    }
    L.push("");
  }

  // ── Evidence notes ────────────────────────────────────────────────────────
  if (s.notes.length) {
    L.push(`## Evidence ledger`);
    L.push("");
    L.push(`_Each evidence block is tied to a source. "unverified" means it came from a search snippet, not fetched page text._`);
    L.push("");
    for (const n of s.notes) {
      const verified = n.verified ? "verified" : "unverified";
      L.push(`- [${n.id}] [${n.sourceId}] (${n.kind ?? n.claim}, ${n.confidence}, ${n.strength ?? "weak"}, ${verified}) ${n.text}`);
      if (n.quote) L.push(`  - quote: “${n.quote}”`);
    }
    L.push("");
  }

  // ── Sources ───────────────────────────────────────────────────────────────
  L.push(`## Sources`);
  L.push("");
  if (s.sources.length) {
    L.push(`| id | quality | trust | freshness | type | source | fetched |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const src of s.sources) {
      L.push(
        `| ${src.id} | ${src.quality?.toFixed?.(2) ?? "—"} | ${trustBadge(src.trust)} ${src.trust.toFixed(2)} | ${src.freshness?.label ?? "unknown"} | ${src.type ?? "unknown"} | [${escapePipe(src.title)}](${src.url}) <br>_${src.domain} — ${escapePipe(src.trustReason)}_ | ${src.fetched ? "✅" : "—"} |`,
      );
    }
  } else {
    L.push(`_No sources were collected._`);
  }
  L.push("");

  // ── Refresh history ───────────────────────────────────────────────────────
  if (s.refreshHistory?.length) {
    L.push(`## Refresh history`);
    L.push("");
    for (const r of s.refreshHistory) {
      L.push(`- ${new Date(r.refreshedAt).toISOString()} — ${r.status}; checked ${r.sourcesChecked}; changed ${r.changedSources.length}; notes added ${r.notesAdded}. ${r.message}`);
    }
    L.push("");
  }

  // ── Research plan (appendix) ──────────────────────────────────────────────
  if (s.plan) {
    L.push(`## Appendix: research plan`);
    L.push("");
    L.push(`**Objective:** ${s.plan.objective}`);
    L.push("");
    L.push(`**Strategy:** ${s.plan.strategy}`);
    L.push("");
    L.push(`**Questions:**`);
    for (const q of s.plan.questions) {
      L.push(`- ${q.text}`);
      if (q.queries.length) L.push(`  - queries: ${q.queries.map((x) => `\`${x}\``).join(", ")}`);
    }
    L.push("");
  }

  L.push("---");
  L.push(`_Generated by XR research mode. XR cites only sources it collected and marks anything it did not verify. Re-run \`xr research summarize\` to regenerate._`);

  const body = L.join("\n");
  const sha256 = createHash("sha256").update(body).digest("hex");
  const markdown = body + `\n\n<!-- xr-research-signature: ${sha256} -->\n`;
  return { markdown, sha256 };
}

/** A compact terminal summary of a session (no file write). */
export function renderTerminalSummary(session: ResearchSession, c: {
  bold: (s: string) => string;
  cyan: (s: string) => string;
  green: (s: string) => string;
  dim: (s: string) => string;
  yellow: (s: string) => string;
}): string {
  const s = session;
  const L: string[] = [];
  if (s.synthesis) {
    L.push(c.bold("Short answer"));
    L.push("  " + s.synthesis.shortAnswer);
    L.push("");
    L.push(c.bold("Executive summary"));
    for (const b of s.synthesis.executiveSummary) L.push("  • " + b);
    if (s.contradictions.length) {
      L.push("");
      L.push(c.yellow("⚠ Contradictions: " + s.contradictions.length));
    }
    L.push("");
    L.push(c.dim(`confidence: ${s.synthesis.overallConfidence} · sources: ${s.sources.length} · notes: ${s.notes.length} (verified ${s.notes.filter(n => n.verified).length})`));
  } else {
    L.push(c.dim("No synthesis yet. Run `xr research summarize`."));
  }
  return L.join("\n");
}

export function renderSourcesList(sources: Source[], c: { cyan: (s: string) => string; dim: (s: string) => string; green: (s: string) => string; yellow: (s: string) => string; red: (s: string) => string; }): string {
  if (!sources.length) return c.dim("  (no sources collected)");
  return sources
    .map((s) => {
      const badge = s.trust >= 0.8 ? c.green : s.trust >= 0.55 ? c.yellow : c.red;
      const fetched = s.fetched ? c.green("fetched") : c.dim("snippet");
      return `  ${badge(`[${s.id}] q=${(s.quality ?? s.trust).toFixed(2)} t=${s.trust.toFixed(2)}`)} ${s.title}\n      ${c.cyan(s.url)}\n      ${c.dim(`${s.domain} · ${s.type ?? "unknown"} · freshness ${s.freshness?.label ?? "unknown"} · ${s.trustReason} · ${fetched}`)}`;
    })
    .join("\n");
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Verify a previously-exported research report wasn't altered. */
export function verifyReport(reportText: string): { valid: boolean; sha256?: string } {
  const m = reportText.match(/<!-- xr-research-signature: ([a-f0-9]{64}) -->/);
  if (!m) return { valid: false };
  const sig = m[1];
  const body = reportText.replace(/\n\n<!-- xr-research-signature: [a-f0-9]{64} -->\n?$/, "");
  const recomputed = createHash("sha256").update(body).digest("hex");
  return { valid: recomputed === sig, sha256: sig };
}

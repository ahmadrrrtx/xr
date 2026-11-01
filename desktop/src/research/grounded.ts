/*
 * Grounded research chat (UI-redesign 2026-10-29).
 *
 * The Research screen's dock chat answers FROM the run that is (or was) on
 * screen — the report, its sources, their evidence lines, contradictions and
 * open questions — instead of re-searching. This module builds that digest
 * and turns it into the bounded system-context block handed to the existing
 * chat stream (chatStore.sendMessageIn, mode 'ask'), so the same budget
 * gates, engine transport and history limits apply. Nothing here invents
 * content: every line traces to a store field the engine actually produced.
 */
import type { ResearchState } from '@/stores/researchStore';

/** Chat session key for a run — stable across dock re-mounts. */
export function researchSessionId(runSessionId: string | null): string {
  return `research:${runSessionId ?? 'adhoc'}`;
}

export interface GroundedSourceLine {
  /** 1-based citation number (order in the report). */
  n: number;
  id: string;
  domain: string;
  title: string;
  url: string;
  status: string;
  trust: number;
  evidence: string[];
}

export interface GroundedDigest {
  topic: string;
  depth: string;
  provider: string;
  model: string;
  status: string;
  shortAnswer: string | null;
  /** Report head (the full report stays in the article pane). */
  reportExcerpt: string;
  sources: GroundedSourceLine[];
  contradictions: Array<{ topic: string; description: string; severity: string }>;
  openQuestions: string[];
}

/** Hard bounds so the digest can never crowd out the user's question. */
const REPORT_EXCERPT_CHARS = 4000;
const MAX_SOURCES = 12;
const MAX_EVIDENCE_PER_SOURCE = 2;
const MAX_CONTRADICTIONS = 4;
const CONTEXT_CAP = 12_000;

/** Cited sources first (in citation order), then any read-but-uncited ones. */
export function groundedDigestFrom(s: ResearchState): GroundedDigest {
  const byId = new Map(s.sources.map((src) => [src.id, src]));
  const cited: GroundedSourceLine[] = [];
  for (const id of s.citations.order) {
    const src = byId.get(id);
    if (!src) continue;
    cited.push({
      n: s.citations.numberFor[id] ?? cited.length + 1,
      id: src.id,
      domain: src.domain,
      title: src.title,
      url: src.url,
      status: src.status,
      trust: src.trust,
      evidence: src.evidence.slice(0, MAX_EVIDENCE_PER_SOURCE),
    });
    byId.delete(id);
  }
  const extra = [...byId.values()]
    .filter((src) => src.status === 'fetched')
    .sort((a, b) => b.trust - a.trust)
    .slice(0, MAX_SOURCES - cited.length)
    .map((src) => ({
      n: 0, // read but never cited — no display number
      id: src.id,
      domain: src.domain,
      title: src.title,
      url: src.url,
      status: src.status,
      trust: src.trust,
      evidence: src.evidence.slice(0, MAX_EVIDENCE_PER_SOURCE),
    }));

  return {
    topic: s.runTopic,
    depth: s.runDepth,
    provider: s.provider,
    model: s.model,
    status: s.phase,
    shortAnswer: s.shortAnswer,
    reportExcerpt: (s.report ?? '').slice(0, REPORT_EXCERPT_CHARS),
    sources: [...cited, ...extra].slice(0, MAX_SOURCES),
    contradictions: s.contradictions
      .slice(0, MAX_CONTRADICTIONS)
      .map((c) => ({ topic: c.topic, description: c.description, severity: String(c.severity) })),
    openQuestions: s.openQuestions.slice(0, 6),
  };
}

/**
 * The system context block. Written as explicit, quotable facts — the model
 * is told to answer ONLY from them and to say so when they don't cover the
 * question, instead of padding with outside knowledge.
 */
export function groundedContextText(d: GroundedDigest): string {
  const parts: string[] = [
    'You are answering questions about a research run the user has on screen. Answer ONLY from the run material below — the report excerpt, sources, evidence lines, contradictions and open questions. If the material does not cover the question, say exactly that; do not substitute outside knowledge. Keep [sN] citation markers when you rely on a source.',
    `Research topic: ${d.topic} (depth: ${d.depth}; run status: ${d.status}).`,
  ];
  if (d.shortAnswer) parts.push(`Short answer from the report: ${d.shortAnswer}`);
  if (d.reportExcerpt) parts.push(`Report excerpt (the full report is in the article pane):\n${d.reportExcerpt}${(d.reportExcerpt.length ?? 0) >= REPORT_EXCERPT_CHARS ? '\n[excerpt truncated]' : ''}`);
  if (d.sources.length) {
    const lines = d.sources.map(
      (src) =>
        `- [s${src.n || '·'}] ${src.domain} — ${src.title} (${src.url})${src.evidence.length ? `\n  evidence: ${src.evidence.map((e) => `“${e}”`).join(' / ')}` : ''}`,
    );
    parts.push(`Sources (n = citation number in the report):\n${lines.join('\n')}`);
  }
  if (d.contradictions.length) {
    parts.push(
      `Contradictions the run found (mention them when relevant):\n${d.contradictions.map((c) => `- (${c.severity}) ${c.topic}: ${c.description}`).join('\n')}`,
    );
  }
  if (d.openQuestions.length) {
    parts.push(`Open questions the report left:\n${d.openQuestions.map((q) => `- ${q}`).join('\n')}`);
  }
  return parts.join('\n\n').slice(0, CONTEXT_CAP);
}

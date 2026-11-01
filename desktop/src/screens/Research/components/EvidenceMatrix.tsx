/*
 * EvidenceMatrix (UI-redesign 2026-10-29) — the at-a-glance table under the
 * report: one row per cited source, in citation order, with the first
 * evidence line quoted. Every cell is data the engine actually produced
 * (store: sources + citations); nothing is inferred. Rows focus the matching
 * source card on the right (focusCitation), the same interaction as a
 * citation marker in the report.
 */
import { Check, Minus, X } from 'lucide-react';

import { isLocalSource, type UiSource } from '@/research/core';
import { useResearchStore } from '@/stores/researchStore';

export function EvidenceMatrix() {
  const sources = useResearchStore((s) => s.sources);
  const citations = useResearchStore((s) => s.citations);
  const focusCitation = useResearchStore((s) => s.focusCitation);

  const byId = new Map<string, UiSource>(sources.map((src) => [src.id, src]));
  const rows = citations.order
    .map((id) => ({ id, n: citations.numberFor[id] ?? 0, src: byId.get(id) }))
    .filter((r): r is { id: string; n: number; src: UiSource } => !!r.src);

  if (rows.length === 0) return null;

  return (
    <section className="xr-matrix" data-testid="evidence-matrix" aria-labelledby="xr-matrix-title">
      <h2 className="xr-matrix-title" id="xr-matrix-title">
        Evidence matrix
      </h2>
      <p className="xr-matrix-sub">
        Every claim in the report maps to a source. {rows.length} cited {rows.length === 1 ? 'source' : 'sources'}, in order of first citation — select a row to open its card on the right.
      </p>
      <div className="xr-matrix-table" role="table" aria-label="Cited sources and their evidence">
        <div className="xr-matrix-row xr-matrix-head" role="row">
          <span className="c-n" role="columnheader">#</span>
          <span className="c-src" role="columnheader">Source</span>
          <span className="c-ev" role="columnheader">Evidence</span>
          <span className="c-tr" role="columnheader">Trust</span>
        </div>
        {rows.map(({ id, n, src }) => {
          const local = isLocalSource(src);
          return (
            <div key={id} role="row" className="xr-matrix-rowwrap" data-testid="evidence-row" data-source-id={id}>
              {/* a11y: a button cannot carry role="row" (aria-allowed-role) and
                  a row's children must be cells (aria-required-children) — so the
                  row owns ONE cell, and the button inside it carries the visual
                  grid and the interaction, the same hit-area pattern as SourceCard. */}
              <div role="cell" className="xr-matrix-cellwrap">
                <button
                  type="button"
                  className="xr-matrix-row xr-matrix-data"
                  onClick={() => focusCitation(id)}
                  title={`Focus source ${src.domain} in the sources panel`}
                >
                  <span className="c-n">{n}</span>
                  <span className="c-src">
                    <span className="d">{local ? src.url.replace('local://', '') : src.domain}</span>
                    <span className="t">{src.title}</span>
                  </span>
                  <span className="c-ev">
                    {src.evidence.length ? <q>{src.evidence[0]}</q> : <span className="none">read, no evidence block extracted</span>}
                  </span>
                  <span className="c-tr">
                    {src.status === 'failed' ? (
                      <X size={12} aria-label="fetch failed" />
                    ) : src.evidence.length ? (
                      <span className="xr-matrix-trust">
                        <Check size={11} aria-hidden="true" />
                        {Math.round(src.trust * 100)}%
                      </span>
                    ) : (
                      <Minus size={12} aria-label="no evidence" />
                    )}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

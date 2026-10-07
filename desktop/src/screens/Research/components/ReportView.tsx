/*
 * The report as a long-form article. `[sN]` markers become numbered cyan
 * superscripts (first-appearance order); clicking one focuses the source
 * card. Contradictions render as a margin-note callout above the body.
 */
import { useReducedMotion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import React, { memo, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CodeBlock } from '@/screens/Chat/components/CodeBlock';
import { fmtAgo, fmtCost, isLocalSource, rewriteCitations, type CitationIndex, type Contradiction, type Stats, type UiDepth, type UiSource } from '@/research/core';
import { useResearchStore } from '@/stores/researchStore';

import { openExternal } from '@/research/open';

const DEPTH_LABEL: Record<UiDepth, string> = { quick: 'Quick', standard: 'Standard', deep: 'Deep', academic: 'Academic' };

function CitationLink({ href, children, numberFor, byId }: { href: string; children: React.ReactNode; numberFor: Record<string, number>; byId: Map<string, UiSource> }) {
  const id = href.slice('#cite-'.length);
  const n = numberFor[id];
  const src = byId.get(id);
  const domain = src ? (isLocalSource(src) ? src.url.replace('local://', '') : src.domain) : id;
  return (
    <sup>
      <a
        href={href}
        className="xr-cite"
        data-testid="citation"
        data-source-id={id}
        aria-label={`Citation ${n ?? ''}, source: ${domain}`}
        title={src ? `${src.title} — ${domain}` : id}
        onClick={(e) => {
          e.preventDefault();
          useResearchStore.getState().focusCitation(id);
        }}
      >
        {children}
      </a>
    </sup>
  );
}

export const ReportMarkdown = memo(function ReportMarkdown({ report, index, sources }: { report: string; index: CitationIndex; sources: UiSource[] }) {
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const content = useMemo(() => rewriteCitations(report, index), [report, index]);
  return (
    <div className="xr-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (p) => {
            const href = typeof p.href === 'string' ? p.href : '';
            if (href.startsWith('#cite-')) return <CitationLink href={href} numberFor={index.numberFor} byId={byId}>{p.children}</CitationLink>;
            return (
              <a
                href={href}
                rel="noreferrer noopener"
                onClick={(e) => {
                  e.preventDefault();
                  if (href) void openExternal(href);
                }}
              >
                {p.children}
              </a>
            );
          },
          code: (props) => {
            const { children } = props as { children?: React.ReactNode };
            return <code>{String(children ?? '').replace(/\n$/, '')}</code>;
          },
          pre: (props) => {
            const child = React.Children.toArray(props.children)[0];
            if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)) {
              const { className, children } = child.props;
              const match = /language-(\S+)/.exec(className ?? '');
              return <CodeBlock code={String(children ?? '').replace(/\n$/, '')} langTag={match?.[1] ?? ''} />;
            }
            return <pre {...props} />;
          },
          table: (p) => (
            <div style={{ overflowX: 'auto' }}>
              <table {...p} />
            </div>
          ),
          input: (p) => (p.type === 'checkbox' ? <input {...p} disabled aria-label="task item" /> : null),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function CiteSup({ id, n }: { id: string; n: number }) {
  return (
    <sup>
      <a
        href={`#cite-${id}`}
        className="xr-cite"
        aria-label={`Citation ${n}`}
        onClick={(e) => {
          e.preventDefault();
          useResearchStore.getState().focusCitation(id);
        }}
      >
        {n}
      </a>
    </sup>
  );
}

/** The engine phrases contradictions with raw ids ("s3 reports…") — show the reader's numbers instead. */
function describeConflict(text: string, numberFor: Record<string, number>): { nodes: React.ReactNode[]; mentioned: Set<string> } {
  const mentioned = new Set<string>();
  const nodes = text.split(/\b(s\d+)\b/g).map((part, i) => {
    const n = numberFor[part];
    if (i % 2 === 1 && n) {
      mentioned.add(part);
      return (
        <span key={i}>
          source <CiteSup id={part} n={n} />
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
  return { nodes, mentioned };
}

function ContradictionsCallout({ items, numberFor }: { items: Contradiction[]; numberFor: Record<string, number> }) {
  const reduced = useReducedMotion() ?? false;
  if (!items.length) return null;
  return (
    <div role="note" aria-label="Conflicting sources" className={reduced ? 'xr-callout' : 'xr-callout xr-callout-pulse'} data-testid="contradictions-callout">
      <div className="title">
        <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
        Sources disagree
      </div>
      <ul>
        {items.map((c) => {
          const { nodes, mentioned } = describeConflict(c.description, numberFor);
          const extra = c.sourceIds.filter((id) => numberFor[id] && !mentioned.has(id));
          return (
            <li key={c.id}>
              {nodes}
              {extra.length ? <> (see {extra.map((id) => <CiteSup key={id} id={id} n={numberFor[id]!} />)})</> : null}
              {c.severity === 'high' ? <span className="xr-badge ml-1.5">high</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface Props {
  topic: string;
  report: string;
  index: CitationIndex;
  sources: UiSource[];
  contradictions: Contradiction[];
  stats: Stats | null;
  endedAt: number | null;
  depth: UiDepth;
  provider: string;
  model: string;
  partialReason: string | null;
  partialNote: string | null;
}

export function ReportView({ topic, report, index, sources, contradictions, stats, endedAt, depth, provider, model, partialReason, partialNote }: Props) {
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  // "Generated X ago" ticks once a minute (the only timer in the article).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const cost = stats ? fmtCost(stats.cost, stats.local) : null;
  // The engine's report starts with its own H1 for the topic; the article
  // header owns the title, so drop a duplicate first heading.
  const body = useMemo(() => report.replace(/^\s*#\s+[^\n]*\n+/, ''), [report]);
  return (
    <article className="xr-article" data-testid="report" aria-labelledby="xr-report-title">
      <h1 id="xr-report-title">{topic}</h1>
      <div className="meta">
        <span>Generated {endedAt ? fmtAgo(endedAt, now) : 'just now'}</span>
        <span aria-hidden="true">·</span>
        <span>
          {sources.length} source{sources.length === 1 ? '' : 's'}
        </span>
        {cost ? (
          <>
            <span aria-hidden="true">·</span>
            <span className={cost === 'local' ? 'xr-badge' : undefined} title={cost === 'local' ? `${provider}/${model} runs locally — $0` : cost === 'unknown' ? 'No price on file for this model' : 'Measured from provider usage'}>
              {cost === 'local' ? 'local' : cost}
            </span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span>{DEPTH_LABEL[depth]} depth</span>
        {model ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{model}</span>
          </>
        ) : null}
      </div>
      {partialReason ? (
        <div className="xr-banner" role="status" data-testid="partial-banner">
          <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--warning)', marginTop: 1 }} />
          <span>{partialReason}</span>
        </div>
      ) : null}
      {partialNote ? (
        <div className="xr-banner info" role="status" data-testid="partial-note">
          <span>{partialNote}</span>
        </div>
      ) : null}
      <ContradictionsCallout items={contradictions} numberFor={index.numberFor} />
      <ReportMarkdown report={body} index={index} sources={sources} />
      {index.order.length ? (
        <section aria-labelledby="xr-cited-title">
          <h2 id="xr-cited-title" className="mt-8 mb-1 text-[13px] font-semibold tracking-[0.04em] uppercase" style={{ color: 'var(--text-tertiary)' }}>
            Sources cited
          </h2>
          <ol className="xr-cited" data-testid="cited-list">
            {index.order.map((id, i) => {
              const s = byId.get(id);
              if (!s) return null;
              const local = isLocalSource(s);
              return (
                <li key={id} id={`cite-${id}`}>
                  <span className="n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => useResearchStore.getState().focusCitation(id)} aria-label={`Citation ${i + 1}, source: ${local ? s.url.replace('local://', '') : s.domain}`}>
                      <cite className="not-italic">{s.title}</cite>
                    </button>
                    <span className="u">{local ? s.url.replace('local://', '') : s.url}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      <footer className="xr-colophon" data-testid="colophon">
        {stats ? (
          <>
            Read {stats.fetchedCount} of {stats.sourceCount} sources · cited {stats.citedCount} · {stats.inTokens.toLocaleString()} in / {stats.outTokens.toLocaleString()} out tokens · {cost === 'local' ? 'local model, $0' : cost === 'unknown' ? 'cost unknown (no price on file)' : `${cost}`}
            {provider || model ? ` · ${[provider, model].filter(Boolean).join('/')}` : ''}
          </>
        ) : (
          'Stored session — token usage was not recorded for it.'
        )}
        <br />
        Every claim links to a source; verify before relying on it.
      </footer>
    </article>
  );
}

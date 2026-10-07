/*
 * One source — status edge (queued · reading · cited · fetched · failed),
 * relevance meter, hover actions (open · copy), inline expansion with type,
 * freshness, trust and the evidence lines the engine extracted.
 */
import { Check, Copy, ExternalLink, FileText, X } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { isLocalSource, type UiSource } from '@/research/core';
import { copyLink, openExternal } from '@/research/open';

const STATUS_LABEL: Record<UiSource['status'], string> = {
  discovering: 'queued',
  found: 'queued',
  reading: 'reading',
  fetched: 'read',
  failed: 'failed',
};

export function Favicon({ domain, local, size = 16 }: { domain: string; local: boolean; size?: number }) {
  // The renderer has no network in the dev preview and the packaged app
  // never calls third-party favicon services (egress is the engine's job):
  // a letter mark is deterministic and theme-safe.
  const letter = (domain.replace(/^www\./, '')[0] ?? '?').toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center rounded font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.6),
        background: local ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-raised)',
        color: local ? 'var(--accent)' : 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {local ? <FileText size={Math.round(size * 0.62)} strokeWidth={2} /> : letter}
    </span>
  );
}

interface Props {
  source: UiSource;
  citationNumber: number | null;
  active: boolean;
  expanded: boolean;
  flashNonce: number;
  animateIn: boolean;
  reducedMotion: boolean;
  onToggle: (id: string) => void;
}

export const SourceCard = memo(function SourceCard({ source: s, citationNumber, active, expanded, flashNonce, animateIn, reducedMotion, onToggle }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The flash class applies while a citation click (nonce) is newer than the
  // last one this card finished animating — no state writes in effects.
  const [seenNonce, setSeenNonce] = useState(0);
  const flash = active && flashNonce > seenNonce;
  const local = isLocalSource(s);

  // Citation click → scroll into view (DOM side effect only).
  useEffect(() => {
    if (!active || !flashNonce) return;
    ref.current?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [active, flashNonce, reducedMotion]);

  const statusText = STATUS_LABEL[s.status];
  const href = local ? null : s.url;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${citationNumber ? `Citation ${citationNumber}, ` : ''}source: ${s.domain}, ${statusText}`}
      data-testid="source-card"
      data-source-id={s.id}
      data-status={s.status}
      data-cited={s.cited ? 'true' : 'false'}
      data-active={active ? 'true' : 'false'}
      className={cn('xr-card', animateIn && !reducedMotion && 'xr-card-in', flash && 'xr-card-flash')}
      style={animateIn && !reducedMotion ? { animationDelay: `${Math.min(29, s.seq) * 60}ms` } : undefined}
      onClick={() => onToggle(s.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(s.id);
        }
      }}
      onAnimationEnd={(e) => {
        if (e.animationName === 'xr-card-flash') setSeenNonce(flashNonce);
      }}
    >
      <div className="head">
        <Favicon domain={s.domain} local={local} size={20} />
        <span className="d">{local ? s.url.replace('local://', '') : s.domain}</span>
        {citationNumber ? (
          <span className="ml-auto shrink-0 font-semibold" style={{ color: 'var(--accent)' }}>
            {citationNumber}
          </span>
        ) : null}
        <span className="xr-pill" data-status={s.status} style={{ marginLeft: citationNumber ? 4 : 'auto' }}>
          {s.status === 'fetched' && s.cited ? <Check size={11} strokeWidth={2.5} aria-hidden="true" /> : null}
          {s.status === 'failed' ? <X size={11} strokeWidth={2.5} aria-hidden="true" /> : null}
          {s.status === 'fetched' && s.cited ? 'cited' : statusText}
        </span>
      </div>
      <div className="t">{s.title}</div>
      {s.snippet ? <div className="s">{s.snippet}</div> : null}
      <div className="xr-meter" title={`Relevance ${Math.round(s.relevance * 100)}%`} aria-hidden="true">
        <span style={{ width: `${Math.round(s.relevance * 100)}%` }} />
      </div>
      <div className="actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {href ? (
          <button type="button" className="xr-mini" aria-label={`Open ${s.domain} in browser`} title="Open ↗" onClick={() => void openExternal(href)}>
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className="xr-mini" aria-label="Copy link" title="Copy link" onClick={() => void copyLink(local ? s.url.replace('local://', '') : s.url)}>
          <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {expanded ? (
        <div className="detail" data-testid="source-detail">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="xr-badge">{s.type === 'unknown' ? 'web' : s.type}</span>
            {!local && s.freshness && s.freshness !== 'unknown' ? (
              <span className="xr-badge" title="Freshness, from the page's Last-Modified or dates in the text">
                {s.freshness}
              </span>
            ) : null}
            {s.status === 'fetched' && s.contentChars >= 500 ? <span className="xr-badge">{(s.contentChars / 1000).toFixed(s.contentChars < 10_000 ? 1 : 0)}k chars</span> : null}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="w-10 shrink-0 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Trust
            </span>
            <div className="xr-meter trust mt-0 flex-1" title={`Trust ${Math.round(s.trust * 100)}%`} aria-label={`Trust ${Math.round(s.trust * 100)} percent`} role="img">
              <span style={{ width: `${Math.round(s.trust * 100)}%` }} />
            </div>
            <span className="w-8 text-right text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              {Math.round(s.trust * 100)}%
            </span>
          </div>
          {s.fetchError ? (
            <p className="mt-2" style={{ color: 'var(--danger)' }}>
              {s.fetchError}
            </p>
          ) : null}
          {s.evidence.length ? (
            <ul>
              {s.evidence.slice(0, 5).map((line, i) => (
                <li key={i}>
                  <cite className="not-italic">{line}</cite>
                </li>
              ))}
            </ul>
          ) : s.status === 'fetched' ? (
            <p className="mt-2">Read, but no evidence block was extracted from it.</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            {href ? (
              <button type="button" className="xr-btn ghost" style={{ minHeight: 28, fontSize: 12 }} onClick={() => void openExternal(href)}>
                <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
                Open in browser
              </button>
            ) : null}
            <button type="button" className="xr-btn ghost" style={{ minHeight: 28, fontSize: 12 }} onClick={() => void copyLink(local ? s.url.replace('local://', '') : s.url)}>
              <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
              Copy
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});

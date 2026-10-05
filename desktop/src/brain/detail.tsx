/*
 * Brain · span detail panel (Phase 9, brief §4e).
 *
 * Inputs / Outputs / Metadata / Error tabs. JSON goes through the Phase 4
 * Shiki setup (dual-theme vars — no re-highlight on theme switch); string
 * outputs render as markdown with code blocks; category-specific views for
 * file / shell / network / approval spans; blinking caret while a span
 * streams. "Re-run from here" is honest: it toasts (runtime is Phase 14).
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, Crosshair, Play } from 'lucide-react';
import { toast } from 'sonner';

import { highlightToHtml } from '@/lib/highlight';
import { MarkdownRenderer } from '@/lib/markdown';
import {
  fmtClockTime,
  fmtDuration,
  fmtRelative,
  fmtTokens,
  fmtUsd,
} from './format';
import { CATEGORY_LABEL, STATUS_LABEL, type Run, type Span } from './types';
import { cn } from '@/lib/utils';

/* ── Shiki JSON block (lazy, theme-agnostic) ─────────────────────────── */
/**
 * Collapsing rule: payloads over 2000 chars start collapsed (plain-text
 * excerpt); "show more" swaps in the fully Shiki-highlighted document.
 * One highlight pass per open, and the dual-theme vars re-skin it on
 * theme change without re-highlight (Phase 4 pattern).
 */
const COLLAPSE_AT = 2000;

function ShikiJson({
  value,
  maxHeight,
}: {
  value: unknown;
  maxHeight?: string;
}) {
  const text = useMemo(
    () => (value == null ? 'null' : JSON.stringify(value, null, 2)),
    [value]
  );
  const long = text.length > COLLAPSE_AT;
  const [expanded, setExpanded] = useState(!long);
  const [cached, setCached] = useState<{ text: string; html: string | null }>({
    text,
    html: null,
  });
  if (cached.text !== text) setCached({ text, html: null });
  const html = cached.html;

  useEffect(() => {
    let alive = true;
    void highlightToHtml(text, 'json').then((h) => {
      if (alive) setCached({ text, html: h });
    });
    return () => {
      alive = false;
    };
  }, [text]);

  const body =
    html && (expanded || !long) ? (
      <pre
        className="shiki font-mono text-[12px] leading-5"
        // sink-allow: shiki engine output only — the text is JSON.stringify'd span data, tokenized and HTML-escaped BY shiki itself (it is a syntax highlighter), so no raw or user-authored HTML can reach this node.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    ) : (
      <pre className="text-text-secondary font-mono text-[12px] leading-5">
        {expanded || !long ? text : text.slice(0, COLLAPSE_AT) + '\n…'}
      </pre>
    );

  return (
    <div className="relative">
      <div
        className="overflow-auto rounded-md p-2.5"
        style={{ maxHeight: maxHeight ?? '100%' }}
      >
        {body}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-accent hover:bg-bg-raised absolute right-2 bottom-2 rounded px-2 py-1 font-mono text-[11px]"
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      )}
    </div>
  );
}

/* ── Category-specific compact views ──────────────────────────────────── */

function MetaLine({
  k,
  v,
  mono = true,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-text-tertiary w-24 shrink-0 text-right font-mono text-[11px]">
        {k}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-[12px] break-all',
          mono && 'font-mono'
        )}
      >
        {v}
      </span>
    </div>
  );
}

function CategoryHeader({ span }: { span: Span }) {
  const md = (span.metadata ?? {}) as Record<string, unknown>;
  switch (span.category) {
    case 'file':
      return (
        <div className="border-border-subtle mb-2 rounded-md border p-2">
          <MetaLine k="path" v={String(md.path ?? '—')} />
          <MetaLine k="bytes" v={fmtBytes(md.bytes)} />
        </div>
      );
    case 'shell':
      return (
        <div className="border-border-subtle mb-2 rounded-md border p-2">
          <MetaLine k="command" v={String(md.command ?? '—')} />
          <MetaLine k="cwd" v={String(md.cwd ?? '—')} />
          <MetaLine
            k="exit"
            v={
              md.exit != null
                ? ((
                    <span
                      className={md.exit === 0 ? 'text-success' : 'text-danger'}
                    >
                      {String(md.exit)}
                    </span>
                  ) as unknown as string)
                : '—'
            }
          />
        </div>
      );
    case 'network':
      return (
        <div className="border-border-subtle mb-2 rounded-md border p-2">
          <MetaLine k="url" v={String(md.url ?? '—')} />
          <MetaLine
            k="status"
            v={
              md.status != null ? (
                (md.status as number) < 400 ? (
                  String(md.status)
                ) : (
                  <span className="text-danger">{String(md.status)}</span>
                )
              ) : (
                '—'
              )
            }
          />
          <MetaLine k="content-type" v={String(md.contentType ?? '—')} />
        </div>
      );
    case 'approval':
      return (
        <div className="border-border-subtle mb-2 rounded-md border p-2">
          <MetaLine k="skill" v={String(md.skill ?? '—')} />
          <MetaLine k="risk" v={String(md.risk ?? '—')} />
          <MetaLine
            k="decision"
            v={
              span.outputs && typeof span.outputs === 'object'
                ? String(
                    (span.outputs as Record<string, unknown>).decision ?? '—'
                  )
                : span.status === 'waiting'
                  ? 'awaiting your decision'
                  : '—'
            }
          />
        </div>
      );
    default:
      return null;
  }
}

function fmtBytes(v: unknown): string {
  if (typeof v !== 'number') return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

/* ── Streaming caret ──────────────────────────────────────────────────── */

function Caret() {
  return (
    <span
      aria-hidden="true"
      className="text-accent ml-0.5 inline-block h-3.5 w-[2px] align-middle"
      style={{ animation: 'xr-caret-blink 1s step-end infinite' }}
    />
  );
}

/* ── The panel ────────────────────────────────────────────────────────── */

type DetailTab = 'inputs' | 'outputs' | 'metadata' | 'error';

export function DetailPanel({ run, span }: { run: Run; span: Span | null }) {
  const [tab, setTab] = useState<DetailTab>('inputs');
  const [rawInputs, setRawInputs] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);
  const [seenSpanId, setSeenSpanId] = useState<string | null | undefined>(
    undefined
  );
  // Reset when the selection changes (render-phase adjustment; the error tab
  // only exists on failure).
  if (span?.id !== seenSpanId) {
    setSeenSpanId(span?.id);
    setTab(span?.error ? 'error' : 'inputs');
    setRawInputs(false);
    setStackOpen(false);
  }
  const spanLive = span?.status === 'running' || span?.status === 'waiting';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!spanLive) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [spanLive]);

  if (!span) {
    return (
      <div className="text-text-tertiary flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Crosshair size={22} strokeWidth={1.5} aria-hidden="true" />
        <span className="text-[13px]">
          Select a span to inspect its inputs and outputs.
        </span>
      </div>
    );
  }

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'inputs', label: 'Inputs' },
    { id: 'outputs', label: 'Outputs' },
    { id: 'metadata', label: 'Metadata' },
    ...(span.error ? [{ id: 'error' as const, label: 'Error' }] : []),
  ];

  const inputIsPrompt = typeof span.inputs === 'string';

  const copyJson = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(span, null, 2));
      toast('Copied span JSON');
    } catch {
      toast('Copy failed — clipboard unavailable');
    }
  };

  return (
    <div className="bg-bg-ink flex h-full min-h-0 flex-col">
      {/* Tab bar */}
      <div className="border-border-subtle flex h-8 shrink-0 items-center border-b px-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'relative h-full px-3 text-[12px] transition-colors',
              tab === t.id
                ? 'text-text-primary font-medium'
                : 'text-text-tertiary hover:text-text-secondary'
            )}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
            {tab === t.id && (
              <span
                aria-hidden="true"
                className="bg-accent absolute right-1 -bottom-px left-1 h-[1.5px] rounded-full"
              />
            )}
          </button>
        ))}
        <button
          type="button"
          aria-label="Copy span JSON"
          onClick={copyJson}
          className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary ml-auto flex h-6 items-center gap-1 rounded px-2 font-mono text-[11px]"
        >
          <Copy size={12} strokeWidth={1.5} aria-hidden="true" />
          Copy JSON
        </button>
      </div>

      {/* Body */}
      <div className="bg-bg-void min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'inputs' && (
          <div className="flex h-full flex-col">
            <CategoryHeader span={span} />
            {span.inputs === undefined ? (
              <EmptyNote text="No inputs recorded for this span." />
            ) : inputIsPrompt && !rawInputs ? (
              <>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-text-tertiary font-mono text-[10px] tracking-wide uppercase">
                    prompt
                  </span>
                  <button
                    type="button"
                    onClick={() => setRawInputs(true)}
                    className="text-accent font-mono text-[11px]"
                  >
                    view raw JSON
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <MarkdownRenderer content={String(span.inputs)} />
                </div>
              </>
            ) : (
              <ShikiJson value={span.inputs} />
            )}
          </div>
        )}

        {tab === 'outputs' && (
          <div className="flex h-full flex-col">
            <CategoryHeader span={span} />
            {span.outputs === undefined ? (
              <EmptyNote
                text={
                  span.status === 'running' || span.status === 'waiting'
                    ? 'Still executing…'
                    : span.status === 'pending'
                      ? 'Has not started.'
                      : 'No output recorded for this span.'
                }
              />
            ) : typeof span.outputs === 'string' ? (
              <div className="min-h-0 flex-1">
                <MarkdownRenderer content={String(span.outputs)} />
                {(span.status === 'running' || span.status === 'waiting') && (
                  <Caret />
                )}
              </div>
            ) : (
              <ShikiJson value={span.outputs} />
            )}
          </div>
        )}

        {tab === 'metadata' && (
          <div>
            <MetaLine k="id" v={span.id} />
            <MetaLine k="parent" v={span.parentId ?? '—'} />
            <MetaLine k="category" v={CATEGORY_LABEL[span.category]} />
            <MetaLine k="status" v={STATUS_LABEL[span.status]} />
            <MetaLine
              k="started"
              v={`${fmtClockTime(span.startedAt)} (${fmtRelative(span.startedAt, now)})`}
            />
            <MetaLine
              k="ended"
              v={
                span.endedAt
                  ? `${fmtClockTime(span.endedAt)} (${fmtRelative(span.endedAt, now)})`
                  : '—'
              }
            />
            <MetaLine
              k="duration"
              v={fmtDuration(
                span.durationMs ??
                  (span.status === 'running' ? now - span.startedAt : null)
              )}
            />
            <MetaLine
              k="offset"
              v={`+${fmtDuration(span.startedAt - run.startedAt)} from run start`}
            />
            {span.model && <MetaLine k="model" v={span.model} />}
            <MetaLine
              k="tokens in"
              v={span.tokensIn != null ? fmtTokens(span.tokensIn) : '—'}
            />
            <MetaLine
              k="tokens out"
              v={span.tokensOut != null ? fmtTokens(span.tokensOut) : '—'}
            />
            <MetaLine
              k="cost"
              v={span.costUsd != null ? fmtUsd(span.costUsd) : '—'}
            />
            {span.childrenIds && (
              <MetaLine k="children" v={String(span.childrenIds.length)} />
            )}
            {span.metadata && Object.keys(span.metadata).length > 0 && (
              <div className="border-border-subtle mt-3 border-t pt-2">
                <div className="text-text-tertiary mb-1 font-mono text-[10px] tracking-wide uppercase">
                  attributes
                </div>
                <ShikiJson value={span.metadata} maxHeight="240px" />
              </div>
            )}
          </div>
        )}

        {tab === 'error' && span.error && (
          <div className="border-danger/40 bg-danger/10 rounded-lg border p-3">
            <div className="text-danger text-[13px] font-semibold">
              {span.error.name}
            </div>
            <div className="text-text-primary mt-1 text-[12px] leading-5">
              {span.error.message}
            </div>
            {span.error.stack && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setStackOpen((v) => !v)}
                  className="text-text-secondary hover:text-text-primary font-mono text-[11px] underline"
                >
                  {stackOpen ? 'hide stack trace' : 'show stack trace'}
                </button>
                {stackOpen && (
                  <pre className="text-text-secondary mt-1.5 overflow-x-auto rounded bg-black/30 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap">
                    {span.error.stack}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer action — honest about Phase 14 */}
      <div className="border-border-subtle flex h-9 shrink-0 items-center border-t px-3">
        <button
          type="button"
          onClick={() =>
            toast(
              'Re-run from span will be available when the agent runtime ships (Phase 14).',
              {
                description: `Selected: ${span.name}`,
              }
            )
          }
          className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex items-center gap-1.5 rounded px-2 py-1 text-[12px]"
          aria-label={`Re-run from ${span.name}`}
        >
          <Play size={12} strokeWidth={1.5} aria-hidden="true" />
          Re-run from here
        </button>
      </div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="text-text-tertiary p-2 text-[12px] italic">{text}</div>
  );
}

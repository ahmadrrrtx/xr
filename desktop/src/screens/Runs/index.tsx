/*
 * Runs — control room (Phase 9: minimal preview; the full virtualized
 * control room with filters/bulk actions/charts ships in Phase 11).
 *
 * Phase 9's job here is narrow: give each mock run row an eye action that
 * opens its trace in the Brain (`/brain/:runId`), one per canned flavour,
 * so the Brain screen is reachable from the control-room surface.
 */
import { useNavigate } from 'react-router-dom';
import { Clock, Eye } from 'lucide-react';

import { fmtDuration, fmtRelative, fmtUsd } from '@/brain/format';
import { STATUS_LABEL, type SpanStatus } from '@/brain/types';

interface MockRunRow {
  id: string;
  shortId: string;
  title: string;
  agent: string;
  model: string;
  status: SpanStatus;
  startedAgoMs: number;
  durationMs: number;
  costUsd: number;
}

// Snapshot list — capture "now" once so render stays pure.
const MOUNT_NOW = Date.now();

const ROWS: MockRunRow[] = [
  {
    id: 'mock-medium',
    shortId: '#847',
    title: 'Summarize Q3 reports',
    agent: 'Main',
    model: 'gpt-4o',
    status: 'completed',
    startedAgoMs: 14 * 60_000,
    durationMs: 27_400,
    costUsd: 0.187,
  },
  {
    id: 'mock-waiting',
    shortId: '#848',
    title: 'Summarize Q3 reports (approval gate)',
    agent: 'Main',
    model: 'gpt-4o',
    status: 'waiting',
    startedAgoMs: 3 * 60_000,
    durationMs: 17_200,
    costUsd: 0.104,
  },
  {
    id: 'mock-error',
    shortId: '#303',
    title: 'Deploy staging build',
    agent: 'Coder',
    model: 'gpt-4o',
    status: 'failed',
    startedAgoMs: 42 * 60_000,
    durationMs: 9_600,
    costUsd: 0.031,
  },
  {
    id: 'mock-long',
    shortId: '#512',
    title: 'Research: agentic AI trust in Q3',
    agent: 'Research',
    model: 'gpt-4o',
    status: 'completed',
    startedAgoMs: 3 * 3_600_000,
    durationMs: 90_000,
    costUsd: 0.942,
  },
  {
    id: 'mock-short',
    shortId: '#101',
    title: 'Quick question: best way to log spans',
    agent: 'Main',
    model: 'gpt-4o-mini',
    status: 'completed',
    startedAgoMs: 6 * 3_600_000,
    durationMs: 4_600,
    costUsd: 0.002,
  },
  {
    id: 'mock-stress',
    shortId: '#900',
    title: 'Stress: 10,000-span ingest',
    agent: 'Main',
    model: 'gpt-4o-mini',
    status: 'completed',
    startedAgoMs: 26 * 3_600_000,
    durationMs: 30_000,
    costUsd: 0.31,
  },
];

const DOT: Record<SpanStatus, string> = {
  running: 'var(--accent)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  waiting: 'var(--warning)',
  killed: 'var(--text-tertiary)',
  pending: 'var(--text-tertiary)',
};

export default function RunsScreen() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-[960px] pb-12">
      <div className="mb-1 flex items-center gap-2">
        <Clock
          size={20}
          strokeWidth={1.5}
          aria-hidden="true"
          className="text-text-secondary"
        />
        <h1 className="text-[20px] font-bold">Runs</h1>
        <span className="text-text-tertiary text-[12px]">
          preview — the full control room ships in Phase 11
        </span>
      </div>
      <p className="text-text-tertiary mb-4 text-[13px]">
        Every agent run XR starts lands here. Open a trace to see exactly what
        it did.
      </p>

      <div className="border-border-subtle bg-bg-ink overflow-hidden rounded-lg border">
        <div className="border-border-subtle grid grid-cols-[56px_minmax(0,1.8fr)_80px_90px_90px_80px_70px_60px_36px] items-center gap-2 border-b px-3 py-2 font-mono text-[10px] tracking-wide uppercase">
          <span className="text-text-tertiary">Status</span>
          <span className="text-text-tertiary">ID</span>
          <span className="text-text-tertiary">Agent</span>
          <span className="text-text-tertiary">Model</span>
          <span className="text-text-tertiary">Started</span>
          <span className="text-text-tertiary">Duration</span>
          <span className="text-text-tertiary">Tokens</span>
          <span className="text-text-tertiary text-right">Cost</span>
          <span />
        </div>
        {ROWS.map((r) => (
          <div
            key={r.id}
            className="border-border-subtle hover:bg-bg-raised/60 grid grid-cols-[56px_minmax(0,1.8fr)_80px_90px_90px_80px_70px_60px_36px] items-center gap-2 border-b px-3 py-2.5 last:border-b-0"
          >
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: DOT[r.status] }}
              />
              <span className="text-text-secondary truncate text-[11px]">
                {STATUS_LABEL[r.status]}
              </span>
            </span>
            <button
              type="button"
              onClick={() => navigate(`/brain/${r.id}`)}
              className="min-w-0 truncate text-left"
              title={r.title}
            >
              <span className="bg-bg-raised mr-2 rounded px-1.5 py-0.5 font-mono text-[11px]">
                {r.shortId}
              </span>
              <span className="text-[13px]">{r.title}</span>
            </button>
            <span className="text-text-secondary truncate text-[12px]">
              {r.agent}
            </span>
            <span className="text-text-secondary truncate font-mono text-[11px]">
              {r.model}
            </span>
            <span className="text-text-tertiary font-mono text-[11px]">
              {fmtRelative(MOUNT_NOW - r.startedAgoMs, MOUNT_NOW)}
            </span>
            <span className="text-text-tertiary font-mono text-[11px]">
              {fmtDuration(r.durationMs)}
            </span>
            <span className="text-text-tertiary font-mono text-[11px]">—</span>
            <span className="text-text-secondary text-right font-mono text-[11px]">
              {fmtUsd(r.costUsd)}
            </span>
            <span className="flex justify-end">
              <button
                type="button"
                onClick={() => navigate(`/brain/${r.id}`)}
                aria-label={`Open trace for ${r.title}`}
                title="Open trace in Brain"
                className="text-text-tertiary hover:bg-bg-raised hover:text-accent focus-visible:ring-accent flex h-7 w-7 items-center justify-center rounded focus-visible:ring-1 focus-visible:outline-none"
              >
                <Eye size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

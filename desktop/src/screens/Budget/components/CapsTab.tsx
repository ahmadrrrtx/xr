/*
 * Budget › Agents / Workspaces (Phase 13). One component, two scopes:
 * SVG bar chart of this month's spend per key + a table with a cap slider
 * per row (0 = no cap, up to $50). Caps are enforced — the governor checks
 * `perAgentCaps` / `perWorkspaceCaps` before every call (core.ts step 5).
 */
import { ArrowUpRight, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { fmtTokens, fmtUsd, niceCeil } from '@/budget/core';
import { SPEND_RANGE_LABEL } from '@/budget/types';
import { useBudgetStore } from '@/stores/budgetStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { BudgetCard, EnforcedBadge, UsageBar } from './shared';

const CAP_MAX = 50;

/* Agents the Brain knows about even before they have spent anything. */
const KNOWN_AGENTS = ['main', 'coder', 'research', 'writer'];

interface CapRow {
  key: string;
  label: string;
  spent: number;
  tokens: number;
  count: number;
  cap: number | null;
}

export function CapsTab({ scope }: { scope: 'agent' | 'workspace' }) {
  const navigate = useNavigate();
  const overview = useBudgetStore((s) => s.overview);
  const settings = useBudgetStore((s) => s.settings);
  const rowsBy = useBudgetStore((s) =>
    scope === 'agent' ? s.byAgent : s.byWorkspace
  );
  const seriesRange = useBudgetStore((s) => s.seriesRange);
  const rangeLabel =
    seriesRange === 'all' ? 'all time' : SPEND_RANGE_LABEL[seriesRange];
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const wsLoaded = useWorkspaceStore((s) => s.loaded);
  const refreshWorkspaces = useWorkspaceStore((s) => s.refresh);

  useEffect(() => {
    if (scope === 'workspace' && !wsLoaded) void refreshWorkspaces();
  }, [scope, wsLoaded, refreshWorkspaces]);

  const caps =
    scope === 'agent' ? settings.perAgentCaps : settings.perWorkspaceCaps;
  const agentSpend = overview?.agentSpend;
  const workspaceSpend = overview?.workspaceSpend;

  const rows = useMemo<CapRow[]>(() => {
    const spendMap: Record<string, number> =
      (scope === 'agent' ? agentSpend : workspaceSpend) ?? {};
    const keys = new Set<string>();
    if (scope === 'agent') KNOWN_AGENTS.forEach((k) => keys.add(k));
    else workspaces.forEach((w) => keys.add(w.slug));
    Object.keys(spendMap).forEach((k) => keys.add(k));
    Object.keys(caps).forEach((k) => keys.add(k));
    rowsBy.forEach((r) => keys.add(r.key));
    const byKey = new Map(rowsBy.map((r) => [r.key, r]));
    return [...keys]
      .map((key) => {
        const b = byKey.get(key);
        const ws =
          scope === 'workspace' ? workspaces.find((w) => w.slug === key) : null;
        return {
          key,
          label: ws?.name ?? key,
          spent: spendMap[key] ?? 0,
          tokens: b?.tokens ?? 0,
          count: b?.count ?? 0,
          cap: caps[key] ?? null,
        };
      })
      .sort((a, b) => b.spent - a.spent || a.key.localeCompare(b.key));
  }, [scope, workspaces, agentSpend, workspaceSpend, caps, rowsBy]);

  const setCap =
    scope === 'agent'
      ? useBudgetStore.getState().setAgentCap
      : useBudgetStore.getState().setWorkspaceCap;
  const noun = scope === 'agent' ? 'agent' : 'workspace';

  if (scope === 'workspace' && wsLoaded && rows.length === 0) {
    return (
      <div
        className="text-text-tertiary flex flex-col items-center justify-center gap-2 py-24 text-[13px]"
        data-testid="caps-empty"
      >
        <FolderOpen size={20} strokeWidth={1.5} aria-hidden="true" />
        <span>
          No workspaces yet — spend is tracked per workspace once you create
          one.
        </span>
        <button
          type="button"
          onClick={() => navigate('/workspaces')}
          className="text-accent flex cursor-pointer items-center gap-1 text-[12px] hover:underline"
        >
          Open Workspaces <ArrowUpRight size={12} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-testid={`budget-${scope}s`}>
      <BudgetCard title={`This month by ${noun}`} testId={`${scope}-chart`}>
        <div className="px-4 pt-1 pb-4">
          <BarChart rows={rows} />
        </div>
      </BudgetCard>

      <BudgetCard
        title="Caps"
        action={
          <span className="text-text-tertiary flex items-center gap-2 text-[11px]">
            Per-{noun} monthly cap <EnforcedBadge />
          </span>
        }
        testId={`${scope}-caps`}
      >
        <table className="w-full text-[12px]" aria-label={`${noun} caps`}>
          <thead>
            <tr className="text-text-tertiary border-border-subtle border-b text-left text-[11px] tracking-[0.04em] uppercase">
              <th className="px-4 py-2 font-medium">
                {scope === 'agent' ? 'Agent' : 'Workspace'}
              </th>
              <th className="px-2 py-2 font-medium">Spent · month</th>
              <th className="px-2 py-2 font-medium">Calls · {rangeLabel}</th>
              <th className="px-2 py-2 font-medium">Tokens · {rangeLabel}</th>
              <th className="w-[46%] px-4 py-2 font-medium">Cap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <CapTableRow
                key={r.key}
                row={r}
                onCommit={(v) => void setCap(r.key, v)}
              />
            ))}
          </tbody>
        </table>
        <p className="text-text-tertiary px-4 py-3 text-[11px]">
          0 = no cap. A capped {noun} is blocked before the call that would
          cross its cap; the rest of XR keeps working.
        </p>
      </BudgetCard>
    </div>
  );
}

function CapTableRow({
  row,
  onCommit,
}: {
  row: CapRow;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? row.cap ?? 0;
  const over = row.cap != null && row.spent >= row.cap - 0.0001;
  return (
    <tr
      className="border-border-subtle/60 border-b last:border-b-0"
      data-testid={`cap-row-${row.key}`}
      data-over={over}
    >
      <td className="text-text-primary px-4 py-2 font-medium">
        {row.label}
        {over && (
          <span className="text-danger ml-2 text-[10px] font-medium uppercase">
            capped
          </span>
        )}
      </td>
      <td className="text-text-secondary px-2 py-2 font-mono tabular-nums">
        {fmtUsd(row.spent, { precise: row.spent > 0 && row.spent < 0.01 })}
      </td>
      <td className="text-text-secondary px-2 py-2 font-mono tabular-nums">
        {row.count}
      </td>
      <td className="text-text-secondary px-2 py-2 font-mono tabular-nums">
        {row.tokens ? fmtTokens(row.tokens) : '—'}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={CAP_MAX}
            step={0.5}
            value={value}
            aria-label={`Monthly cap for ${row.label}`}
            aria-valuetext={value === 0 ? 'no cap' : fmtUsd(value)}
            data-testid={`cap-slider-${row.key}`}
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={() => {
              if (draft != null) onCommit(draft);
              setDraft(null);
            }}
            onKeyUp={() => {
              if (draft != null) onCommit(draft);
              setDraft(null);
            }}
            onBlur={() => {
              if (draft != null) onCommit(draft);
              setDraft(null);
            }}
            className="budget-range flex-1"
            style={{ ['--range-pct' as string]: `${(value / CAP_MAX) * 100}%` }}
          />
          <span
            className="text-text-secondary w-16 text-right font-mono text-[12px] tabular-nums"
            data-testid={`cap-value-${row.key}`}
          >
            {value === 0 ? 'no cap' : fmtUsd(value)}
          </span>
        </div>
        {row.cap != null && (
          <div className="mt-1.5">
            <UsageBar
              value={row.spent}
              max={row.cap}
              cap={row.cap}
              height={4}
            />
          </div>
        )}
      </td>
    </tr>
  );
}

/* ── SVG bars ──────────────────────────────────────────────────────────── */

function BarChart({ rows }: { rows: CapRow[] }) {
  const top = rows.slice(0, 8);
  const max = niceCeil(
    Math.max(0.01, ...top.map((r) => Math.max(r.spent, r.cap ?? 0)))
  );
  const W = 640;
  const barH = 18;
  const gap = 10;
  const labelW = 120;
  const H = top.length * (barH + gap) + 8;
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Spend per key this month"
        className="block h-auto w-full max-w-[720px]"
      >
        {top.map((r, i) => {
          const y = 4 + i * (barH + gap);
          const w = ((W - labelW - 70) * r.spent) / max;
          const capX =
            r.cap != null ? labelW + ((W - labelW - 70) * r.cap) / max : null;
          const over = r.cap != null && r.spent >= r.cap - 0.0001;
          return (
            <g key={r.key}>
              <text
                x={labelW - 10}
                y={y + barH / 2 + 4}
                textAnchor="end"
                fontSize={12}
                fill="var(--text-secondary)"
              >
                {r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label}
              </text>
              <rect
                x={labelW}
                y={y}
                width={W - labelW - 70}
                height={barH}
                rx={4}
                fill="var(--bg-raised)"
              />
              <rect
                x={labelW}
                y={y}
                width={Math.max(0, w)}
                height={barH}
                rx={4}
                fill={over ? 'var(--budget-danger)' : 'var(--accent)'}
                opacity={0.85}
              >
                <animate
                  attributeName="width"
                  from="0"
                  to={Math.max(0, w)}
                  dur="0.6s"
                  fill="freeze"
                />
              </rect>
              {capX != null && (
                <line
                  x1={capX}
                  x2={capX}
                  y1={y - 3}
                  y2={y + barH + 3}
                  stroke="var(--text-primary)"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                />
              )}
              <text
                x={W - 62}
                y={y + barH / 2 + 4}
                fontSize={11}
                fill="var(--text-primary)"
                fontFamily="var(--font-mono, ui-monospace)"
              >
                {fmtUsd(r.spent)}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Spend per key this month</caption>
        <tbody>
          {top.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{fmtUsd(r.spent, { precise: true })}</td>
              <td>{r.cap != null ? `cap ${fmtUsd(r.cap)}` : 'no cap'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

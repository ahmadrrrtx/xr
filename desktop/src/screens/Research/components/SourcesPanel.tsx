/*
 * Right column — every source the engine ranked, with All / Used in report /
 * Conflicting tabs. Plain list under 100 cards (so arrival animations and
 * inline expansion stay natural); react-window above that.
 */
import { useReducedMotion } from 'framer-motion';
import { PanelRightClose } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { List } from 'react-window';

import { useResearchStore, type SourcesTab } from '@/stores/researchStore';
import type { UiSource } from '@/research/core';

import { SourceCard } from './SourceCard';

const VIRTUALIZE_AT = 100;
const SLIDE_CAP = 30;

const TABS: Array<{ id: SourcesTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'cited', label: 'Used in report' },
  { id: 'conflicting', label: 'Conflicting' },
];

interface RowProps {
  sources: UiSource[];
  numberFor: Record<string, number>;
  activeId: string | null;
  expandedId: string | null;
  flashNonce: number;
  reduced: boolean;
  onToggle: (id: string) => void;
  index: number;
  style: React.CSSProperties;
  ariaAttributes: Record<string, unknown>;
}

function VirtualRow({ sources, numberFor, activeId, expandedId, flashNonce, reduced, onToggle, index, style, ariaAttributes }: RowProps) {
  const s = sources[index];
  if (!s) return null;
  return (
    <div style={style} {...ariaAttributes}>
      <SourceCard source={s} citationNumber={numberFor[s.id] ?? null} active={activeId === s.id} expanded={expandedId === s.id} flashNonce={activeId === s.id ? flashNonce : 0} animateIn={false} reducedMotion={reduced} onToggle={onToggle} />
    </div>
  );
}

function rowHeight(index: number, props: Omit<RowProps, 'index' | 'style' | 'ariaAttributes'>): number {
  const s = props.sources[index];
  if (!s) return 120;
  const base = 128 + (s.snippet ? 36 : 0);
  if (props.expandedId !== s.id) return base;
  return base + 110 + Math.min(5, s.evidence.length) * 40 + (s.fetchError ? 24 : 0);
}

export const SourcesPanel = memo(function SourcesPanel({ height }: { height: number }) {
  const sources = useResearchStore((s) => s.sources);
  const numberFor = useResearchStore((s) => s.citations.numberFor);
  const contradictions = useResearchStore((s) => s.contradictions);
  const tab = useResearchStore((s) => s.sourcesTab);
  const setTab = useResearchStore((s) => s.setSourcesTab);
  const activeId = useResearchStore((s) => s.activeSourceId);
  const flashNonce = useResearchStore((s) => s.focusNonce);
  const toggleSources = useResearchStore((s) => s.toggleSources);
  const reduced = useReducedMotion() ?? false;
  // A citation click (newer nonce) auto-expands its card; a manual toggle
  // records the nonce it answered so later clicks still win.
  const [expanded, setExpanded] = useState<{ id: string | null; nonce: number }>({ id: null, nonce: 0 });
  const expandedId = flashNonce > expanded.nonce ? activeId : expanded.id;

  const conflicting = useMemo(() => new Set(contradictions.flatMap((c) => c.sourceIds)), [contradictions]);
  const visible = useMemo(() => {
    if (tab === 'cited') return sources.filter((s) => s.cited);
    if (tab === 'conflicting') return sources.filter((s) => conflicting.has(s.id));
    return sources;
  }, [sources, tab, conflicting]);

  const onToggle = useCallback(
    (id: string) => {
      const st = useResearchStore.getState();
      setExpanded((cur) => {
        const current = st.focusNonce > cur.nonce ? st.activeSourceId : cur.id;
        return { id: current === id ? null : id, nonce: st.focusNonce };
      });
      st.setActiveSource(id);
    },
    [],
  );

  const counts = {
    all: sources.length,
    cited: sources.filter((s) => s.cited).length,
    conflicting: sources.filter((s) => conflicting.has(s.id)).length,
  };

  return (
    <aside className="xr-pane xr-right h-full" aria-label={`Sources (${sources.length})`} data-testid="sources-panel" style={{ width: '100%' }}>
      <div className="xr-src-head">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Sources <span style={{ color: 'var(--text-tertiary)' }}>({sources.length})</span>
          </h2>
          <button type="button" className="xr-mini" aria-label="Collapse sources panel" title="Collapse (⌘/)" onClick={() => toggleSources(true)}>
            <PanelRightClose size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="xr-tabs" role="tablist" aria-label="Source filters">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`sources-tab-${t.id}`}>
              {t.label}
              <span className="ml-1 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                {counts[t.id]}
              </span>
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="xr-empty">
          {sources.length === 0 ? 'Sources appear here as the engine finds them.' : tab === 'cited' ? 'No source is cited in the report yet.' : 'No conflicting sources were detected.'}
        </div>
      ) : visible.length > VIRTUALIZE_AT ? (
        <div className="xr-src-list" style={{ padding: 0 }}>
          <List<Omit<RowProps, 'index' | 'style' | 'ariaAttributes'>>
            rowComponent={VirtualRow}
            rowCount={visible.length}
            rowHeight={rowHeight}
            rowKey={(i) => visible[i]?.id ?? String(i)}
            rowProps={{ sources: visible, numberFor, activeId, expandedId, flashNonce, reduced, onToggle }}
            overscanCount={4}
            style={{ height: Math.max(120, height - 92), padding: 8 }}
          />
        </div>
      ) : (
        <div className="xr-src-list" role="list">
          {visible.map((s) => (
            <div role="listitem" key={s.id}>
              <SourceCard source={s} citationNumber={numberFor[s.id] ?? null} active={activeId === s.id} expanded={expandedId === s.id} flashNonce={activeId === s.id ? flashNonce : 0} animateIn={s.seq < SLIDE_CAP} reducedMotion={reduced} onToggle={onToggle} />
            </div>
          ))}
        </div>
      )}
    </aside>
  );
});

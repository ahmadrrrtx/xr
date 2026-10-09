/*
 * Memory Explorer (Phase 21). Everything shown here comes from the engine:
 * entries, recall ids, flags, graph and export. The screen only arranges it.
 *
 * Shortcuts (inside this screen; ⌘N stays "New chat" app-wide):
 *   /  or ⌘F   focus search        ⌥⌘N  focus the Remember composer
 *   ⌘E         export              ↑ ↓   move through entries
 *   Esc        deselect            ⌫     delete the selected entry (with Undo)
 */
import '@/styles/memory.css';
import { useEffect, useMemo, useState } from 'react';
import { Brain, Download, Network, Settings2, Upload, List as ListIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useMemoryStore, type Tab } from '@/stores/memoryStore';
import { countByCategory, filterMemories, type MemoryView } from '@/memory/core';
import { QuickAdd } from './components/QuickAdd';
import { EntryList } from './components/EntryList';
import { EntryDetail } from './components/EntryDetail';
import { MemoryGraph } from './components/MemoryGraph';
import { MemoryDialogs } from './components/MemoryDialogs';

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function MemoryScreen() {
  const load = useMemoryStore((s) => s.load);
  const entries = useMemoryStore((s) => s.entries);
  const loading = useMemoryStore((s) => s.loading);
  const error = useMemoryStore((s) => s.error);
  const engineDown = useMemoryStore((s) => s.engineDown);
  const query = useMemoryStore((s) => s.query);
  const matchIds = useMemoryStore((s) => s.matchIds);
  const setQuery = useMemoryStore((s) => s.setQuery);
  const category = useMemoryStore((s) => s.category);
  const scope = useMemoryStore((s) => s.scope);
  const showExpired = useMemoryStore((s) => s.showExpired);
  const tab = useMemoryStore((s) => s.tab);
  const setTab = useMemoryStore((s) => s.setTab);
  const selectedId = useMemoryStore((s) => s.selectedId);
  const select = useMemoryStore((s) => s.select);
  const remove = useMemoryStore((s) => s.remove);
  const exportAll = useMemoryStore((s) => s.exportAll);
  const setDialog = useMemoryStore((s) => s.setDialog);
  const [searchInput, setSearchInput] = useState(query);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced engine search (200 ms). The store ignores stale responses.
  useEffect(() => {
    const t = window.setTimeout(() => void setQuery(searchInput), 200);
    return () => window.clearTimeout(t);
  }, [searchInput, setQuery]);

  const visible = useMemo(
    () => filterMemories(entries, { category, scope, showExpired, matchIds }),
    [entries, category, scope, showExpired, matchIds],
  );
  const selected: MemoryView | null = useMemo(() => entries.find((e) => e.id === selectedId) ?? null, [entries, selectedId]);

  const stats = useMemo(() => {
    const now = Date.now();
    const live = entries.filter((e) => e.expiresAt == null || e.expiresAt > now);
    return {
      globalFacts: live.filter((e) => e.category === 'fact' && e.scope === 'global').length,
      preferences: live.filter((e) => e.category === 'preference').length,
      workspace: live.filter((e) => e.scope !== 'global' && e.category !== 'exclusion').length,
      exclusions: live.filter((e) => e.category === 'exclusion').length,
      counts: countByCategory(entries, now),
    };
  }, [entries]);

  // Keyboard shortcuts for the list/detail view.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey;
      const key = ev.key.toLowerCase();
      if (ev.altKey && mod && key === 'n') {
        ev.preventDefault();
        setTab('list');
        document.getElementById('mx-composer')?.focus();
        return;
      }
      if (mod && key === 'e' && !isEditableTarget(ev.target)) {
        ev.preventDefault();
        void doExport();
        return;
      }
      if ((mod && key === 'f') || (key === '/' && !isEditableTarget(ev.target) && !mod)) {
        ev.preventDefault();
        document.getElementById('mx-search')?.focus();
        return;
      }
      if (isEditableTarget(ev.target) || tab !== 'list') return;
      if (ev.key === 'Escape') {
        select(null);
        return;
      }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (visible.length === 0) return;
        ev.preventDefault();
        const i = visible.findIndex((e) => e.id === selectedId);
        const next = ev.key === 'ArrowDown' ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1);
        select(visible[next === -1 ? 0 : next]!.id);
        document.getElementById(`mx-item-${visible[next === -1 ? 0 : next]!.id}`)?.focus();
        return;
      }
      if ((ev.key === 'Backspace' || ev.key === 'Delete') && selected) {
        ev.preventDefault();
        void remove(selected.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, visible, selectedId, selected, select, remove, setTab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doExport() {
    try {
      const where = await exportAll();
      if (where) toast('Exported', { description: `${entries.length} memories · ${where.split(/[\\/]/).pop()}` });
    } catch (e) {
      toast.error('Export failed', { description: e instanceof Error ? e.message : String(e) });
    }
  }

  const today = Date.now();
  const expiredCount = entries.filter((e) => e.expiresAt != null && e.expiresAt <= today).length;

  return (
    <div className="mx-root" data-testid="memory-screen">
      <header className="mx-head">
        <div>
          <h1 className="mx-title">Memory</h1>
          <p className="mx-sub">
            What XR remembers about you, your projects and your preferences. Local-first. You control it. XR saves only what you ask it to.
          </p>
        </div>
        <div className="mx-actions">
          <Button variant="outline" size="sm" onClick={() => void doExport()} disabled={engineDown || entries.length === 0}>
            <Download /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDialog('import')} disabled={engineDown}>
            <Upload /> Import
          </Button>
          <Button variant="outline" size="sm" aria-label="Memory settings" onClick={() => setDialog('settings')}>
            <Settings2 /> Settings
          </Button>
        </div>
      </header>

      {engineDown && (
        <div className="mx-banner mx-banner-warn" role="status" style={{ margin: '0 24px 12px' }}>
          {error ?? 'The engine is not reachable.'}
        </div>
      )}

      <section className="mx-stats" aria-label="Memory summary">
        <Stat label="Global facts" value={stats.globalFacts} />
        <Stat label="Preferences" value={stats.preferences} />
        <Stat label="Workspace & project" value={stats.workspace} />
        <Stat label="Do-not-remember rules" value={stats.exclusions} />
      </section>

      <div className="mx-tabs" role="tablist" aria-label="Memory views">
        <TabButton id="list" current={tab} onSelect={setTab} icon={<ListIcon size={14} />}>
          List
        </TabButton>
        <TabButton id="graph" current={tab} onSelect={setTab} icon={<Network size={14} />}>
          Graph
        </TabButton>
      </div>

      {tab === 'list' ? (
        <div className="mx-body" role="tabpanel" aria-label="List">
          <div className="mx-left">
            <QuickAdd />
            <EntryList
              entries={visible}
              all={entries}
              loading={loading}
              query={query}
              searchValue={searchInput}
              onSearch={setSearchInput}
              counts={stats.counts}
              expiredHidden={!showExpired ? expiredCount : 0}
              onShowExpired={() => void useMemoryStore.getState().setShowExpired(true)}
              hasAny={entries.length > 0}
              engineDown={engineDown}
            />
          </div>
          <div className="mx-right">
            {selected ? (
              <EntryDetail key={selected.id} entry={selected} all={entries} />
            ) : (
              <div className="mx-empty">
                <Brain size={28} aria-hidden />
                <p>Select a memory to see where it came from, or remember something new.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div role="tabpanel" aria-label="Graph" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <MemoryGraph />
        </div>
      )}

      <MemoryDialogs />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="mx-stat">
      <div className="mx-stat-label">{label}</div>
      <div className="mx-stat-value" aria-live="polite">
        {value}
      </div>
    </div>
  );
}

function TabButton({
  id,
  current,
  onSelect,
  icon,
  children,
}: {
  id: Tab;
  current: Tab;
  onSelect: (t: Tab) => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`mx-tab-${id}`}
      aria-selected={current === id}
      aria-controls={`mx-panel-${id}`}
      className="mx-tab"
      onClick={() => onSelect(id)}
    >
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {icon}
        {children}
      </span>
    </button>
  );
}

/*
 * Phase 10 — Workspaces launch pad (docs/SCREEN-BRIEFS.md · SCREEN 3).
 *
 * 64px header (title · + New Workspace · multi-window toggle · grid/list) ·
 * 44px sub-header (search 280 + filter chips w/ counts) · collapsible
 * template strip · responsive grid (2/3/4) or list · dashed "+ New" card ·
 * empty / skeleton / error states · glass launch bar · screen-scoped
 * keyboard nav (`/`, ⌘N, ⌘⌥O, arrows+Enter, P, M, A, Esc, shift-click).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Plus, RefreshCw, Search } from 'lucide-react';

import { LaunchBar } from '@/components/workspaces/LaunchBar';
import { NewWorkspaceModal } from '@/components/workspaces/NewWorkspaceModal';
import { DeleteDialog } from '@/components/workspaces/DeleteDialog';
import { RenameDialog } from '@/components/workspaces/RenameDialog';
import { SkeletonCard } from '@/components/workspaces/SkeletonCard';
import { TemplateStrip } from '@/components/workspaces/TemplateStrip';
import { WorkspaceCard } from '@/components/workspaces/WorkspaceCard';
import { WorkspaceListRow } from '@/components/workspaces/WorkspaceListRow';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  filterCounts,
  filterWorkspaces,
  orderWorkspaces,
  useWorkspaceStore,
} from '@/stores/workspaceStore';
import { WORKSPACE_TEMPLATES } from '@/workspaces/templates';
import type { Workspace } from '@/workspaces/types';

type RenameState = { ws: Workspace } | null;
type DeleteState = { ws: Workspace } | null;

export default function WorkspacesScreen() {
  const s = useWorkspaceStore();
  const navigate = useNavigate();
  const hydrated = useSettingsStore((st) => st.hydrated);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [renaming, setRenaming] = useState<RenameState>(null);
  const [deleting, setDeleting] = useState<DeleteState>(null);
  const [launching, setLaunching] = useState(false);

  // Load the working set on mount (cheap local read; keeps the palette fresh
  // while the screen is mounted).
  useEffect(() => {
    void s.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time sync from persisted settings (settings hydrate async).
  useEffect(() => {
    if (!hydrated) return;
    const w = useSettingsStore.getState().settings.workspaces;
    const st = useWorkspaceStore.getState();
    if (st.viewMode !== w.viewMode) st.setViewMode(w.viewMode);
    if (st.filter !== w.filter) st.setFilter(w.filter);
    if (st.templateStripCollapsed !== w.templateStripCollapsed)
      st.setStripCollapsed(w.templateStripCollapsed);
  }, [hydrated]);

  const ordered = useMemo(() => orderWorkspaces(s.workspaces), [s.workspaces]);
  const visible = useMemo(
    () => filterWorkspaces(ordered, s.filter, s.search),
    [ordered, s.filter, s.search]
  );
  const counts = useMemo(() => filterCounts(s.workspaces), [s.workspaces]);

  const selectWithRange = useCallback(
    (id: string, shift: boolean) => {
      const st = useWorkspaceStore.getState();
      if (!st.multiSelect) {
        st.enterMultiSelect(id);
        return;
      }
      if (shift && st.focusedId) {
        const ids = visible.map((w) => w.id);
        const a = ids.indexOf(st.focusedId);
        const b = ids.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          st.selectAll(ids.slice(lo, hi + 1));
          st.focusId(id);
          return;
        }
      }
      st.toggleSelected(id);
      st.focusId(id);
    },
    [visible]
  );

  const doLaunch = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setLaunching(true);
    try {
      await useWorkspaceStore.getState().launch(ids);
    } finally {
      setLaunching(false);
      useWorkspaceStore.getState().exitMultiSelect();
    }
  }, []);

  // ── Screen-scoped keyboard nav ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      const st = useWorkspaceStore.getState();
      // A dialog owns the keyboard while open (Radix handles Escape).
      if (st.modalOpen || st.cloneBusy) return;

      // Escape: exit multi-select → blur search → nothing
      if (e.key === 'Escape') {
        if (typing && target) {
          target.blur();
          return;
        }
        if (st.multiSelect) st.exitMultiSelect();
        else if (st.focusedId) st.focusId(null);
        return;
      }
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      // ⌘N — new workspace
      if (mod && (e.key === 'n' || e.key === 'N') && !e.altKey) {
        e.preventDefault();
        st.openModal();
        return;
      }
      // ⌘⌥O — open (launch) focused
      if (mod && e.altKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        const ws = st.workspaces.find((w) => w.id === st.focusedId);
        if (ws) void doLaunch([ws.id]);
        return;
      }
      // ⌘/Ctrl+C — copy focused path
      if (mod && (e.key === 'c' || e.key === 'C') && st.focusedId) {
        const ws = st.workspaces.find((w) => w.id === st.focusedId);
        if (ws && navigator.clipboard) {
          e.preventDefault();
          void navigator.clipboard.writeText(ws.path);
        }
        return;
      }
      if (mod) return;

      // `/` — focus search
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      // M — multi-select
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        if (st.multiSelect) st.exitMultiSelect();
        else st.enterMultiSelect(st.focusedId ?? undefined);
        return;
      }
      // A — select all visible
      if ((e.key === 'a' || e.key === 'A') && st.multiSelect) {
        e.preventDefault();
        st.selectAll(visible.map((w) => w.id));
        return;
      }
      // P — pin focused
      if ((e.key === 'p' || e.key === 'P') && st.focusedId) {
        const ws = st.workspaces.find((w) => w.id === st.focusedId);
        if (ws) {
          e.preventDefault();
          void st.togglePin(ws);
        }
        return;
      }
      // Arrows — move focus (grid steps by columns)
      if (
        ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Enter'].includes(
          e.key
        )
      ) {
        if (visible.length === 0) return;
        const cols = colsForWidth(window.innerWidth, s.viewMode);
        const idx = visible.findIndex((w) => w.id === st.focusedId);
        if (e.key === 'Enter') {
          e.preventDefault();
          if (st.focusedId) {
            if (st.multiSelect) st.toggleSelected(st.focusedId);
            else navigate(`/workspaces/${st.focusedId}`);
          }
          return;
        }
        e.preventDefault();
        let next = idx;
        if (idx === -1) {
          next = 0;
        } else {
          switch (e.key) {
            case 'ArrowRight':
              next = Math.min(idx + 1, visible.length - 1);
              break;
            case 'ArrowLeft':
              next = Math.max(idx - 1, 0);
              break;
            case 'ArrowDown':
              next = Math.min(idx + cols, visible.length - 1);
              break;
            case 'ArrowUp':
              next = Math.max(idx - cols, 0);
              break;
            default:
              break;
          }
        }
        const target = visible[next];
        if (target) {
          st.focusId(target.id);
          document
            .querySelector(`[data-workspace-card="${CSS.escape(target.id)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, s.viewMode, doLaunch, navigate]);

  const onPickTemplate = useCallback(
    (t: (typeof WORKSPACE_TEMPLATES)[number]) => {
      useWorkspaceStore.getState().openModal(t.id);
    },
    []
  );

  const onStripClone = useCallback((url: string, name: string | null) => {
    void useWorkspaceStore.getState().clone(url, name);
  }, []);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      data-screen="workspaces"
    >
      {/* ── Header (64px) ─────────────────────────────────────────────── */}
      <header className="flex h-16 shrink-0 items-center justify-between px-4">
        <h1 className="text-[24px] leading-none font-semibold tracking-tight">
          Workspaces
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="new-workspace-btn"
            onClick={() => s.openModal()}
            className="bg-accent text-accent-contrast flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" strokeWidth={1.5} />
            New Workspace
          </button>
          <HeaderToggle
            active={s.multiSelect}
            onClick={() =>
              s.multiSelect
                ? s.exitMultiSelect()
                : s.enterMultiSelect(s.focusedId ?? undefined)
            }
            label={
              s.multiSelect ? 'Exit multi-window mode' : 'Multi-window mode'
            }
            activeLabel="Multi-window on"
          >
            <LayoutGrid className="size-4" strokeWidth={1.5} />
          </HeaderToggle>
          <div
            role="group"
            aria-label="View mode"
            className="border-border-subtle flex h-8 items-center rounded-lg border p-0.5"
          >
            <Segmented
              active={s.viewMode === 'grid'}
              onClick={() => s.setViewMode('grid')}
              label="Grid view"
            >
              <LayoutGrid className="size-3.5" strokeWidth={1.5} />
            </Segmented>
            <Segmented
              active={s.viewMode === 'list'}
              onClick={() => s.setViewMode('list')}
              label="List view"
            >
              <List className="size-3.5" strokeWidth={1.5} />
            </Segmented>
          </div>
        </div>
      </header>

      {/* ── Sub-header (44px): search + filters ────────────────────────── */}
      <div className="flex h-11 shrink-0 items-center gap-3 px-4">
        <div className="relative w-[280px]">
          <Search
            className="text-text-tertiary pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            strokeWidth={1.5}
          />
          <input
            ref={searchRef}
            data-testid="ws-search"
            value={s.search}
            onChange={(e) => s.setSearch(e.target.value)}
            placeholder="Search workspaces…"
            aria-label="Search workspaces"
            className="border-border-subtle placeholder:text-text-tertiary focus:border-border-default h-7 w-full rounded-lg border bg-transparent pr-8 pl-8 text-[12.5px] transition-colors outline-none"
          />
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        </div>

        <div
          role="group"
          aria-label="Filter"
          className="flex items-center gap-1"
        >
          <FilterChip
            active={s.filter === 'all'}
            onClick={() => s.setFilter('all')}
            label="All"
            count={counts.all}
          />
          <FilterChip
            active={s.filter === 'pinned'}
            onClick={() => s.setFilter('pinned')}
            label="Pinned"
            count={counts.pinned}
          />
          <FilterChip
            active={s.filter === 'recent'}
            onClick={() => s.setFilter('recent')}
            label="Recent 7d"
            count={counts.recent}
          />
          <FilterChip
            active={s.filter === 'git'}
            onClick={() => s.setFilter('git')}
            label="Git"
            count={counts.git}
          />
        </div>

        <span className="text-text-tertiary ml-auto hidden text-[11px] xl:block">
          {visible.length} of {s.workspaces.length}
        </span>
      </div>

      {/* ── Template strip ─────────────────────────────────────────────── */}
      <TemplateStrip
        collapsed={s.templateStripCollapsed}
        onToggleCollapsed={s.setStripCollapsed}
        onPick={onPickTemplate}
        onClone={onStripClone}
        cloning={s.cloneBusy}
      />

      {/* ── Content ────────────────────────────────────────────────────── */}
      <main className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-24">
        {s.loading && !s.loaded ? (
          <div className="grid grid-cols-2 gap-3 min-[1280px]:grid-cols-3 min-[1600px]:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : s.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-[13px]">{s.error}</p>
            <button
              type="button"
              onClick={() => void s.refresh()}
              className="text-accent flex cursor-pointer items-center gap-1.5 text-[12.5px] font-medium"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.5} />
              Retry
            </button>
          </div>
        ) : s.workspaces.length === 0 ? (
          <EmptyState onCreate={() => s.openModal()} />
        ) : visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <p className="text-text-secondary text-[13px]">
              No workspaces match
              {s.search.trim() ? ` “${s.search.trim()}”` : ' this filter'}.
            </p>
            <button
              type="button"
              onClick={() => {
                s.setSearch('');
                s.setFilter('all');
              }}
              className="text-accent cursor-pointer text-[12.5px] font-medium"
            >
              Clear search and filters
            </button>
          </div>
        ) : s.viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 min-[1280px]:grid-cols-3 min-[1600px]:grid-cols-4">
            {visible.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                ws={ws}
                multiSelect={s.multiSelect}
                selected={s.selectedIds.includes(ws.id)}
                focused={s.focusedId === ws.id}
                onSelect={selectWithRange}
                onLaunch={(w) => void doLaunch([w.id])}
                onReveal={(w) => void s.reveal(w)}
                onLocate={(w) => void s.locate(w)}
                onPin={(w) => void s.togglePin(w)}
                onRename={(w) => setRenaming({ ws: w })}
                onDuplicate={(w) => void s.duplicate(w.id)}
                onDelete={(w) => setDeleting({ ws: w })}
              />
            ))}
            <button
              type="button"
              data-testid="new-card"
              onClick={() => s.openModal()}
              className="border-border-default text-text-tertiary hover:border-accent/50 hover:text-text-secondary flex h-[164px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-colors"
            >
              <span className="border-border-default flex size-9 items-center justify-center rounded-full border">
                <Plus className="size-4" strokeWidth={1.5} />
              </span>
              <span className="text-[12px]">New workspace</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visible.map((ws) => (
              <WorkspaceListRow
                key={ws.id}
                ws={ws}
                multiSelect={s.multiSelect}
                selected={s.selectedIds.includes(ws.id)}
                focused={s.focusedId === ws.id}
                onSelect={selectWithRange}
                onLaunch={(w) => void doLaunch([w.id])}
                onReveal={(w) => void s.reveal(w)}
                onLocate={(w) => void s.locate(w)}
                onPin={(w) => void s.togglePin(w)}
                onRename={(w) => setRenaming({ ws: w })}
                onDuplicate={(w) => void s.duplicate(w.id)}
                onDelete={(w) => setDeleting({ ws: w })}
              />
            ))}
          </div>
        )}

        {s.multiSelect && (
          <LaunchBar
            count={s.selectedIds.length}
            totalCount={visible.length}
            launching={launching}
            onLaunch={() => void doLaunch(s.selectedIds)}
            onSelectAll={() => s.selectAll(visible.map((w) => w.id))}
            onExit={() => s.exitMultiSelect()}
          />
        )}
      </main>

      {/* ── Modals / dialogs ───────────────────────────────────────────── */}
      <NewWorkspaceModal
        open={s.modalOpen}
        initialTemplate={s.modalTemplate}
        creating={s.creating}
        cloning={s.cloneBusy}
        progress={s.cloneProgress}
        error={s.cloneError}
        onClose={s.closeModal}
        onCreate={(name, templateId, folder) =>
          void s.create(name, templateId, folder)
        }
        onClone={(url, name) => void s.clone(url, name)}
      />
      {renaming && (
        <RenameDialog
          open
          initialName={renaming.ws.name}
          onCancel={() => setRenaming(null)}
          onRename={(name) => {
            void s.rename(renaming.ws, name).then(() => setRenaming(null));
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          open
          name={deleting.ws.name}
          path={deleting.ws.path}
          pathExists={deleting.ws.pathExists}
          onCancel={() => setDeleting(null)}
          onConfirm={(deleteFiles) => {
            const ws = deleting.ws;
            setDeleting(null);
            void s.remove(ws.id, deleteFiles);
          }}
        />
      )}
    </div>
  );
}

function colsForWidth(width: number, mode: 'grid' | 'list'): number {
  if (mode === 'list') return 1;
  if (width >= 1600) return 4;
  if (width >= 1280) return 3;
  return 2;
}

/* ── Small header pieces ───────────────────────────────────────────────── */

function HeaderToggle({
  active,
  onClick,
  label,
  activeLabel,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  activeLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid="multi-window-toggle"
      aria-pressed={active}
      title={active ? activeLabel : label}
      onClick={onClick}
      className={cn(
        'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors',
        active
          ? 'border-accent/60 text-accent bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]'
          : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary'
      )}
    >
      {children}
      {active ? (
        <span className="sr-only">on</span>
      ) : (
        <span className="sr-only">off</span>
      )}
    </button>
  );
}

function Segmented({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-bg-raised text-text-primary'
          : 'text-text-tertiary hover:text-text-secondary'
      )}
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      data-testid={`filter-${label.toLowerCase().replace(/\s+/g, '-')}`}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors',
        active
          ? 'border-accent/60 text-accent bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]'
          : 'border-border-subtle text-text-secondary hover:border-border-default'
      )}
    >
      {label}
      <span
        className={cn(
          'font-mono text-[10.5px]',
          active ? 'opacity-80' : 'text-text-tertiary'
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────── */

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-10">
      <svg
        width="180"
        height="120"
        viewBox="0 0 180 120"
        fill="none"
        aria-hidden
        className="ws-empty-art"
      >
        {/* folder */}
        <path
          d="M28 40c0-4.4 3.6-8 8-8h24l8 10h40c4.4 0 8 3.6 8 8v40c0 4.4-3.6 8-8 8H36c-4.4 0-8-3.6-8-8V40z"
          fill="var(--bg-raised)"
          stroke="var(--border-default)"
          strokeWidth="1.5"
        />
        <path d="M28 52h124" stroke="var(--border-subtle)" strokeWidth="1.5" />
        {/* orb */}
        <circle
          cx="122"
          cy="46"
          r="22"
          fill="color-mix(in oklab, var(--accent) 14%, transparent)"
          stroke="var(--accent)"
          strokeOpacity="0.55"
          strokeWidth="1.5"
        />
        <circle
          cx="122"
          cy="46"
          r="10"
          fill="var(--accent)"
          fillOpacity="0.8"
        />
        <circle cx="117" cy="41" r="3.5" fill="#fff" fillOpacity="0.5" />
        {/* motion dots */}
        <circle cx="30" cy="24" r="2" fill="var(--text-tertiary)" />
        <circle cx="44" cy="16" r="1.5" fill="var(--text-tertiary)" />
        <circle cx="156" cy="20" r="2" fill="var(--text-tertiary)" />
      </svg>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h2 className="text-[15px] font-medium">No workspaces yet</h2>
        <p className="text-text-secondary max-w-[340px] text-[12.5px] leading-5">
          A workspace is a real folder on your machine — scaffold one from a
          template above, or clone a repository.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="bg-accent text-accent-contrast flex h-9 cursor-pointer items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-opacity hover:opacity-90"
      >
        <Plus className="size-4" strokeWidth={1.5} />
        New workspace
      </button>
      <p className="text-text-tertiary text-[11px]">
        or press <Kbd>⌘N</Kbd>
      </p>
    </div>
  );
}

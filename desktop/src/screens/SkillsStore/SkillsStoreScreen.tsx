/*
 * Skills Store (Phase 20) — the App-store face of the engine's skill runtime.
 *
 *   head      title · "Install from URL…" · "Check for updates" · Installed: N
 *   toolbar   480px search (200ms debounce, / focuses, Esc clears)
 *   body      category sidebar (200px, collapsible) · featured hero · card grid
 *
 * Listings, trust, permissions and quarantine are the ENGINE's. This screen
 * renders them; it never decides trust on its own.
 */
import { Download, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import '@/styles/skills.css';
import { useSkillsStore } from '@/stores/skillsStore';
import { CATEGORY_DEFS, cardState, filterByCategory, matchesQuery, type CategoryId, type SkillRecord } from '@/skills/core';

import { AddMcpDialog } from './components/AddMcpDialog';
import { CategorySidebar } from './components/CategorySidebar';
import { McpCard, PluginCard } from './components/ExtensionsSection';
import { FeaturedBanner } from './components/FeaturedBanner';
import { InstallModal } from './components/InstallModal';
import { QuickInstall } from './components/QuickInstall';
import { SkillCard } from './components/SkillCard';
import { SkillDetail } from './components/SkillDetail';

const SEARCH_DEBOUNCE_MS = 200;
let launchSyncDone = false;

export default function SkillsStoreScreen() {
  const records = useSkillsStore((s) => s.records);
  const mcpServers = useSkillsStore((s) => s.mcpServers);
  const plugins = useSkillsStore((s) => s.plugins);
  const loading = useSkillsStore((s) => s.loading);
  const error = useSkillsStore((s) => s.error);
  const offline = useSkillsStore((s) => s.offline);
  const catalogNote = useSkillsStore((s) => s.catalogNote);
  const featuredId = useSkillsStore((s) => s.featuredId);
  const featuredFromRegistry = useSkillsStore((s) => s.featuredFromRegistry);
  const query = useSkillsStore((s) => s.query);
  const category = useSkillsStore((s) => s.category);
  const railCollapsed = useSkillsStore((s) => s.railCollapsed);
  const selectedId = useSkillsStore((s) => s.selectedId);
  const installOpen = useSkillsStore((s) => s.install.open);
  const load = useSkillsStore((s) => s.load);
  const setQuery = useSkillsStore((s) => s.setQuery);
  const selectCategory = useSkillsStore((s) => s.selectCategory);
  const openDetail = useSkillsStore((s) => s.openDetail);
  const openInstall = useSkillsStore((s) => s.openInstall);
  const openInstallFromUrl = useSkillsStore((s) => s.openInstallFromUrl);
  const toggleEnabled = useSkillsStore((s) => s.toggleEnabled);
  const setRailCollapsed = useSkillsStore((s) => s.setRailCollapsed);
  const setQuickInstallOpen = useSkillsStore((s) => s.setQuickInstallOpen);
  const quickOpen = useSkillsStore((s) => s.quickInstallOpen);
  const openAddMcp = useSkillsStore((s) => s.openAddMcp);

  const [draft, setDraft] = useState(query);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());

  // Boot: local listing immediately; one background registry sync per launch.
  useEffect(() => {
    void load();
    if (!launchSyncDone) {
      launchSyncDone = true;
      void load({ sync: true }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, []);

  // Debounced search → store.
  useEffect(() => {
    const t = setTimeout(() => setQuery(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, setQuery]);

  // Global keys: / focuses search, ⌘K / Ctrl+K opens quick install.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.matches?.('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickInstallOpen(!useSkillsStore.getState().quickInstallOpen);
        return;
      }
      if (e.key === '/' && !typing && !selectedId && !installOpen && !quickOpen) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, installOpen, quickOpen, setQuickInstallOpen]);

  const featured = featuredId ? records.find((r) => r.id === featuredId) ?? null : null;
  const showHero = category === 'featured' && !draft.trim() && Boolean(featured);

  const visible = useMemo(() => {
    const base = query.trim() ? records.filter((r) => matchesQuery(r, query)) : records;
    return filterByCategory(base, category).filter((r) => !(showHero && featured && r.id === featured.id));
  }, [records, query, category, showHero, featured]);

  const counts = useMemo(() => {
    const out = {} as Record<CategoryId, number>;
    for (const def of CATEGORY_DEFS) out[def.id] = def.action ? 0 : filterByCategory(records, def.id).length;
    return out;
  }, [records]);

  const installedCount = records.filter((r) => r.installed).length + mcpServers.length + plugins.length;
  const categoryLabel = CATEGORY_DEFS.find((d) => d.id === category)?.label ?? 'Skills';
  const showInstalledExtras = category === 'installed';

  const orderedIds = visible.map((r) => r.id);

  const focusCard = (id: string) => {
    setFocusedId(id);
    cardRefs.current.get(id)?.focus();
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-skill-id]');
    const id = card?.getAttribute('data-skill-id');
    if (!id) return;
    const i = orderedIds.indexOf(id);
    if (i < 0) return;
    const cols = gridRef.current ? Math.max(1, getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').filter(Boolean).length) : 1;
    let next = -1;
    if (e.key === 'ArrowRight') next = i + 1;
    if (e.key === 'ArrowLeft') next = i - 1;
    if (e.key === 'ArrowDown') next = i + cols;
    if (e.key === 'ArrowUp') next = i - cols;
    if (next >= 0 && next < orderedIds.length) {
      e.preventDefault();
      focusCard(orderedIds[next]);
      return;
    }
    if ((e.key === 'i' || e.key === 'I') && !e.metaKey && !e.ctrlKey) {
      const rec = records.find((r) => r.id === id);
      if (rec && cardState(rec) === 'install') {
        e.preventDefault();
        openInstall(id);
      } else if (rec && cardState(rec) === 'update') {
        e.preventDefault();
        openInstall(id, 'update');
      }
    }
  };

  return (
    <div className="sk-root" data-testid="skills-screen">
      <header className="sk-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="sk-title">Skills</h1>
          <p className="sk-subtitle">Add capabilities to XR. Every skill is quarantined by default — you decide what it can do.</p>
        </div>
        <div className="sk-head-actions">
          <button type="button" className="sk-btn sk-btn--link" onClick={openInstallFromUrl} data-testid="install-from-url">
            <Download size={14} strokeWidth={1.5} aria-hidden="true" /> Install from URL…
          </button>
          <button
            type="button"
            className="sk-btn"
            onClick={() => void load({ sync: true })}
            disabled={loading}
            data-testid="check-updates"
          >
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" className={loading ? 'sk-spin' : undefined} />
            Check for updates
          </button>
          <button type="button" className="sk-count-chip" onClick={() => selectCategory('installed')} aria-label={`Installed: ${installedCount}. Show installed`} data-testid="installed-chip">
            Installed: {installedCount}
          </button>
        </div>
      </header>

      <div className="sk-toolbar">
        <div className="sk-search" role="search">
          <Search className="sk-search-icon" size={15} strokeWidth={1.5} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={draft}
            placeholder="Search skills…"
            aria-label="Search skills"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft('');
                setQuery('');
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'ArrowDown' && orderedIds.length) {
                e.preventDefault();
                focusCard(orderedIds[0]);
              }
            }}
            data-testid="skills-search"
          />
          {draft ? (
            <button type="button" className="sk-search-clear" aria-label="Clear search" onClick={() => { setDraft(''); setQuery(''); }}>
              <X size={14} strokeWidth={1.5} />
            </button>
          ) : null}
        </div>
        <span className="sk-hint">Press / to search · ⌘K quick install</span>
      </div>

      <div className="sk-body">
        <CategorySidebar
          active={category}
          counts={counts}
          collapsed={railCollapsed}
          onSelect={(c) => selectCategory(c)}
          onToggleCollapsed={() => setRailCollapsed(!railCollapsed)}
        />

        <main className="sk-main" aria-labelledby="skills-main-title">
          <div style={{ paddingTop: 4 }}>
            {offline ? (
              <div className="sk-notice" data-tone="warn" role="status" data-testid="offline-banner">
                <div className="sk-notice-body">
                  <strong>Offline — showing installed skills only.</strong> Check your connection or Shield egress settings.
                </div>
                <button type="button" className="sk-btn" onClick={() => void load({ sync: true })}>Retry</button>
              </div>
            ) : null}
            {!offline && catalogNote ? (
              <div className="sk-notice" role="status">
                <div className="sk-notice-body">{catalogNote}</div>
              </div>
            ) : null}
            {error && !offline ? (
              <div className="sk-notice" data-tone="danger" role="alert">
                <div className="sk-notice-body">{error}</div>
                <button type="button" className="sk-btn" onClick={() => void load()}>Retry</button>
              </div>
            ) : null}
          </div>

          <h2 id="skills-main-title" className="sk-section" style={{ marginTop: 6 }}>
            {categoryLabel}
            {query.trim() ? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· results for “{query.trim()}”</span> : null}
          </h2>

          {showHero && featured ? (
            <FeaturedBanner
              record={featured}
              fromRegistry={featuredFromRegistry}
              onOpen={openDetail}
              onInstall={(id) => openInstall(id)}
            />
          ) : null}

          {loading && records.length === 0 ? (
            <div className="sk-grid" aria-busy="true" aria-label="Loading skills">
              {Array.from({ length: 9 }).map((_, i) => <div key={i} className="sk-skel" />)}
            </div>
          ) : null}

          {!loading || records.length > 0 ? (
            <div ref={gridRef} className="sk-grid" role="group" aria-label={`${categoryLabel} skills`} onKeyDown={onGridKey} data-testid="skills-grid">
              {visible.map((r: SkillRecord, i) => (
                <SkillCard
                  key={r.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(r.id, el);
                    else cardRefs.current.delete(r.id);
                  }}
                  record={r}
                  index={i}
                  focused={focusedId === r.id}
                  onOpen={openDetail}
                  onInstall={(id) => openInstall(id)}
                  onUpdate={(id) => openInstall(id, 'update')}
                  onToggle={(id) => void toggleEnabled(id)}
                  onFocusCard={setFocusedId}
                />
              ))}
            </div>
          ) : null}

          {!loading && visible.length === 0 && records.length > 0 ? (
            query.trim() ? (
              <div className="sk-empty" data-testid="no-results">
                <h3>No skills match “{query.trim()}”.</h3>
                <p>Try a different search, or <button type="button" className="sk-btn sk-btn--link" onClick={openInstallFromUrl}>install from URL</button>.</p>
              </div>
            ) : category === 'installed' ? (
              <div className="sk-empty">
                <h3>Nothing installed yet.</h3>
                <p>Browse Featured to find a skill. Installs start quarantined.</p>
              </div>
            ) : category === 'updates' ? (
              <div className="sk-empty">
                <h3>Everything is up to date.</h3>
                <p>Skills with a newer registry version appear here.</p>
              </div>
            ) : (
              <div className="sk-empty">
                <h3>No skills in this category yet.</h3>
                <p><button type="button" className="sk-btn sk-btn--link" onClick={() => selectCategory('featured')}>Browse all skills</button></p>
              </div>
            )
          ) : null}

          {records.length === 0 && !loading && !error ? (
            <div className="sk-empty">
              <h3>No skills found.</h3>
              <p>XR ships with bundled skills; if this is empty the engine has no skill directory yet.</p>
            </div>
          ) : null}

          {showInstalledExtras ? (
            <section aria-labelledby="ext-mcp" style={{ marginTop: 24 }}>
              <div className="sk-section" id="ext-mcp" style={{ justifyContent: 'space-between' }}>
                <span>MCP servers · {mcpServers.length}</span>
                <button type="button" className="sk-btn sk-btn--link" onClick={openAddMcp} data-testid="add-mcp">
                  + Add MCP server
                </button>
              </div>
              {mcpServers.length === 0 ? (
                <p className="sk-hint">No custom MCP servers yet. Add a local command or a remote endpoint.</p>
              ) : (
                <div className="sk-grid">{mcpServers.map((s, i) => <McpCard key={s.id} server={s} index={i} />)}</div>
              )}
              <section aria-labelledby="ext-plugins" style={{ marginTop: 20 }}>
                <div className="sk-section" id="ext-plugins">Plugins · {plugins.length}</div>
                {plugins.length === 0 ? (
                  <p className="sk-hint" data-testid="plugins-empty">
                    No plugins installed. Plugins install from a folder on this machine with{' '}
                    <code>xr plugins install ./my-plugin</code>. They appear here once installed, and each permission
                    stays off until you grant it.
                  </p>
                ) : (
                  <div className="sk-grid">{plugins.map((p, i) => <PluginCard key={p.id} plugin={p} index={i} />)}</div>
                )}
              </section>
            </section>
          ) : null}
        </main>
      </div>

      {records.length > 0 ? <InstallModal records={records} /> : null}
      <SkillDetail records={records} />
      <AddMcpDialog />
      <QuickInstall records={records} />
    </div>
  );
}

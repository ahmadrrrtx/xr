/*
 * Integrations (Phase 22). The list comes from the engine (ConnectorRegistry plus
 * connection state), so no connector is hard-coded here. Cards are grouped by
 * category and can be searched. Connect is the only bright control on a card.
 */
import '@/styles/integrations.css';
import { useEffect, useMemo, useRef } from 'react';
import { Plug, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AddMcpDialog } from '@/screens/SkillsStore/components/AddMcpDialog';
import { useSkillsStore } from '@/stores/skillsStore';
import { useIntegrationsStore } from '@/stores/integrationsStore';
import { CATEGORY_CHIPS, countByCategory, filterIntegrations } from '@/integrations/core';
import { openInSystemBrowser } from '@/integrations/browser';
import { IntegrationCard } from './components/IntegrationCard';
import { ApiKeyDialog, AppCredentialsDialog } from './components/ConnectDialogs';

const REQUEST_URL =
  'https://github.com/ahmadrrrtx/xr/issues/new?title=' +
  encodeURIComponent('Integration request: ') +
  '&labels=integration-request';

export default function IntegrationsScreen() {
  const connectors = useIntegrationsStore((s) => s.connectors);
  const loaded = useIntegrationsStore((s) => s.loaded);
  const loading = useIntegrationsStore((s) => s.loading);
  const loadError = useIntegrationsStore((s) => s.loadError);
  const category = useIntegrationsStore((s) => s.category);
  const query = useIntegrationsStore((s) => s.query);
  const setCategory = useIntegrationsStore((s) => s.setCategory);
  const setQuery = useIntegrationsStore((s) => s.setQuery);
  const cardError = useIntegrationsStore((s) => s.cardError);
  const busyId = useIntegrationsStore((s) => s.busyId);
  const dialog = useIntegrationsStore((s) => s.dialog);
  const load = useIntegrationsStore((s) => s.load);
  const openAddMcp = useSkillsStore((s) => s.openAddMcp);
  const connect = useIntegrationsStore((s) => s.connect);
  const searchRef = useRef<HTMLInputElement>(null);

  // The deep-link listener is registered at app root (App.tsx). This screen only loads its list.
  useEffect(() => {
    void load();
  }, [load]);

  // "/" focuses search, unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts = useMemo(() => countByCategory(connectors), [connectors]);
  const visible = useMemo(() => filterIntegrations(connectors, { category, query }), [connectors, category, query]);
  const connected = connectors.filter((c) => c.status === 'connected');
  const needsAttention = connectors.filter((c) => c.status === 'expired' || c.status === 'error');
  const dialogView = dialog ? connectors.find((c) => c.id === dialog.id) : undefined;
  const quick = connectors.filter((c) => c.support === 'available' && c.status !== 'connected');
  const offline = loadError !== null && /fetch|network|engine|offline|unreachable/i.test(loadError);

  return (
    <div className="ix-screen" data-testid="integrations-screen">
      <header className="ix-head">
        <div className="ix-head__text">
          <h1 className="ix-head__title">Integrations</h1>
          <p className="ix-head__sub">
            Connect only the apps you choose. Credentials are encrypted on this computer.
          </p>
        </div>
        <div className="ix-head__actions">
          <Button variant="outline" size="sm" onClick={() => openAddMcp()}>
            Connect custom MCP server
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void openInSystemBrowser(REQUEST_URL).catch(() => undefined)}>
            Request integration
          </Button>
        </div>
      </header>

      {offline && (
        <div role="status" className="ix-banner ix-banner--warn">
          Offline. XR cannot reach the engine right now, so connections cannot change.
        </div>
      )}
      {loadError && !offline && (
        <div role="alert" className="ix-banner ix-banner--error">
          Couldn't load integrations. {loadError}
          <Button variant="ghost" size="sm" onClick={() => void load()}>Retry</Button>
        </div>
      )}
      {needsAttention.length > 0 && (
        <div role="status" className="ix-banner ix-banner--warn">
          {needsAttention.length === 1 ? `${needsAttention[0].name} needs you to sign in again.` : `${needsAttention.length} connections need you to sign in again.`}
        </div>
      )}

      <div className="ix-toolbar">
        <div role="group" aria-label="Filter by category" className="ix-chips-row">
          {CATEGORY_CHIPS.map((c) => {
            const count = counts[c.id] ?? 0;
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                className={`ix-cat ${active ? 'ix-cat--active' : ''}`}
                onClick={() => setCategory(c.id)}
                disabled={c.id !== 'all' && count === 0}
              >
                {c.label}
                <span className="ix-cat__count" aria-label={`${count} integrations`}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="ix-search">
          <Search size={14} aria-hidden="true" className="ix-search__icon" />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search integrations…  ( / )"
            aria-label="Search integrations"
            className="ix-search__input"
          />
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        {loaded ? `${connected.length} connected of ${connectors.length} integrations.` : ''}
      </div>

      {!loaded && loading && (
        <div className="ix-grid" aria-busy="true" aria-label="Loading integrations">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="ix-card ix-card--skeleton" aria-hidden="true">
              <Skeleton className="ix-skel ix-skel--tile" />
              <Skeleton className="ix-skel ix-skel--line" />
              <Skeleton className="ix-skel ix-skel--line short" />
            </div>
          ))}
        </div>
      )}

      {loaded && connected.length === 0 && !query && category === 'all' && (
        <section className="ix-empty" aria-labelledby="ix-empty-title">
          <Plug size={28} aria-hidden="true" className="ix-empty__icon" />
          <h2 id="ix-empty-title" className="ix-empty__title">Connect an app to let XR work with it</h2>
          <p className="ix-empty__sub">Nothing is connected yet. Each connection is opt-in and you can disconnect it at any time.</p>
          <div className="ix-empty__actions">
            {quick.slice(0, 3).map((c) => (
              <Button key={c.id} variant="outline" size="sm" onClick={() => void connect(c.id)}>
                Connect {c.name}
              </Button>
            ))}
          </div>
        </section>
      )}

      {loaded && (
        <div className="ix-grid" data-testid="integrations-grid">
          {visible.map((view, index) => (
            <IntegrationCard
              key={view.id}
              view={view}
              index={index}
              error={cardError[view.id]}
              busy={busyId === view.id}
            />
          ))}
          {visible.length === 0 && (
            <p className="ix-none">No integrations match “{query}”{category !== 'all' ? ' in this category' : ''}.</p>
          )}
        </div>
      )}

      {dialog && dialogView && dialog.kind === 'api_key' && <ApiKeyDialog view={dialogView} />}
      {dialog && dialogView && dialog.kind === 'app_credentials' && <AppCredentialsDialog view={dialogView} />}
      <AddMcpDialog />
    </div>
  );
}

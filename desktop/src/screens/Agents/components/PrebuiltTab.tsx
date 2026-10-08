/*
 * Prebuilt gallery (Phase 19) — the engine's agent registry. Favourites
 * first (settings), then registry order; search + role-family chips.
 * Read-only: "View config" opens the definition, "Duplicate to My Agents"
 * seeds the editor with it.
 */
import { AlertTriangle, Search } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { familyOf, matchesQuery, ROLE_FAMILIES, type RoleFamily } from '@/agents/core';
import { selectPrebuilt, useAgentsStore } from '@/stores/agentsStore';
import { useSettingsStore } from '@/stores/settingsStore';

import { AgentCard } from './AgentCard';

export function PrebuiltTab() {
  const navigate = useNavigate();
  const agents = useAgentsStore(selectPrebuilt);
  const loading = useAgentsStore((s) => s.loading && !s.loaded);
  const error = useAgentsStore((s) => s.error);
  const query = useAgentsStore((s) => s.query);
  const family = useAgentsStore((s) => s.family);
  const favorites = useSettingsStore((s) => s.settings.agents.favoriteAgents);

  const visible = useMemo(() => {
    const fav = new Set(favorites);
    return agents
      .filter((a) => (family === 'all' || familyOf(a.role) === family) && matchesQuery(a, query))
      .sort((a, b) => Number(fav.has(b.id)) - Number(fav.has(a.id)));
  }, [agents, favorites, family, query]);

  const familiesPresent = useMemo(() => new Set(agents.map((a) => familyOf(a.role))), [agents]);

  return (
    <div className="xa-scroll" data-testid="prebuilt-tab">
      <div className="xa-filters">
        <label className="xa-search">
          <Search size={14} strokeWidth={1.75} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search specialists"
            aria-label="Search prebuilt agents"
            value={query}
            onChange={(e) => useAgentsStore.getState().setQuery(e.target.value)}
            data-testid="prebuilt-search"
          />
        </label>
        <button type="button" className="xa-chip" aria-pressed={family === 'all'} onClick={() => useAgentsStore.getState().setFamily('all')}>
          All
        </button>
        {ROLE_FAMILIES.filter((f) => familiesPresent.has(f.id)).map((f) => (
          <FamilyChip key={f.id} id={f.id} label={f.label} active={family === f.id} onClick={() => useAgentsStore.getState().setFamily(family === f.id ? 'all' : f.id)} />
        ))}
        <span className="xa-help" style={{ marginLeft: 'auto' }}>
          {agents.length ? `${visible.length} of ${agents.length}` : ''}
        </span>
      </div>

      {error ? (
        <div className="xa-note xa-note--warn" role="status">
          <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
          {error}
          <button type="button" className="xa-btn xa-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => void useAgentsStore.getState().load({ force: true })}>
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="xa-grid" aria-busy="true" aria-label="Loading agents">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="xa-skeleton" />
          ))}
        </div>
      ) : visible.length === 0 && !error ? (
        <div className="xa-empty">
          <h3>No specialists match</h3>
          <p>Try another word or clear the role filter.</p>
        </div>
      ) : (
        <div className="xa-grid">
          {visible.map((a, i) => (
            <AgentCard
              key={a.id}
              agent={a}
              index={i}
              favorite={favorites.includes(a.id)}
              onToggleFavorite={() => useAgentsStore.getState().toggleFavorite(a.id)}
              onStartChat={() => navigate(`/chat?agent=${encodeURIComponent(a.id)}`)}
              menu={[
                { id: 'chat', label: 'Start chat', onSelect: () => navigate(`/chat?agent=${encodeURIComponent(a.id)}`) },
                { id: 'favorite', label: favorites.includes(a.id) ? 'Remove favourite' : 'Favourite', onSelect: () => useAgentsStore.getState().toggleFavorite(a.id) },
                { id: 'config', label: 'View config', onSelect: () => useAgentsStore.getState().openConfig(a.id) },
                { id: 'duplicate', label: 'Duplicate to My Agents', separatorBefore: true, onSelect: () => useAgentsStore.getState().openDuplicateFromPrebuilt(a.id) },
              ]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FamilyChip({ id, label, active, onClick }: { id: RoleFamily; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className="xa-chip" aria-pressed={active} onClick={onClick} data-testid={`family-${id}`}>
      <span className="xa-chip-dot" style={{ ['--xa-color' as string]: `var(--xa-${id})` }} aria-hidden="true" />
      {label}
    </button>
  );
}

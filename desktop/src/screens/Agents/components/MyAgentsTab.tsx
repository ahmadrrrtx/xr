/*
 * My Agents (Phase 19) — the user's custom agents, plus a dashed
 * "+ Create Agent" tile. Empty state offers three quick-start templates
 * (each a real, editable form — nothing is saved until the user does).
 */
import { AlertTriangle, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { AGENT_TEMPLATES, matchesQuery } from '@/agents/core';
import { selectCustom, useAgentsStore } from '@/stores/agentsStore';
import { useSettingsStore } from '@/stores/settingsStore';

import { AgentCard } from './AgentCard';

export function MyAgentsTab() {
  const navigate = useNavigate();
  const agents = useAgentsStore(selectCustom);
  const loading = useAgentsStore((s) => s.loading && !s.loaded);
  const error = useAgentsStore((s) => s.error);
  const query = useAgentsStore((s) => s.query);
  const favorites = useSettingsStore((s) => s.settings.agents.favoriteAgents);
  const visible = useMemo(() => agents.filter((a) => matchesQuery(a, query)).sort((a, b) => (b.custom?.updatedAt ?? 0) - (a.custom?.updatedAt ?? 0)), [agents, query]);

  if (!loading && !error && agents.length === 0) {
    return (
      <div className="xa-scroll" data-testid="mine-tab">
        <div className="xa-empty" data-testid="mine-empty">
          <h3>No custom agents yet</h3>
          <p>An agent is a system prompt, a tool allowlist, a model and a budget. Saved as versioned JSON in the engine.</p>
          <div className="xa-row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button type="button" className="xa-btn xa-btn--primary" onClick={() => useAgentsStore.getState().openCreate()} data-testid="mine-create">
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              Create agent
            </button>
          </div>
          <div className="xa-templates">
            {AGENT_TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="xa-template" onClick={() => useAgentsStore.getState().openTemplate(t.id)} data-testid={`template-${t.id}`}>
                <strong>
                  <span aria-hidden="true">{t.form.emoji} </span>
                  {t.title}
                </strong>
                <span>{t.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="xa-scroll" data-testid="mine-tab">
      {error ? (
        <div className="xa-note xa-note--warn" role="status" style={{ marginBottom: 14 }}>
          <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
          {error}
          <button type="button" className="xa-btn xa-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => void useAgentsStore.getState().load({ force: true })}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="xa-grid">
        <button type="button" className="xa-card xa-card--create" onClick={() => useAgentsStore.getState().openCreate()} data-testid="mine-create-card">
          <Plus size={22} strokeWidth={1.5} aria-hidden="true" />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Create agent</span>
        </button>
        {loading
          ? Array.from({ length: 3 }, (_, i) => <div key={i} className="xa-skeleton" />)
          : visible.map((a, i) => (
              <AgentCard
                key={a.id}
                agent={a}
                index={i}
                favorite={favorites.includes(a.id)}
                onToggleFavorite={() => useAgentsStore.getState().toggleFavorite(a.id)}
                onStartChat={() => navigate(`/chat?agent=${encodeURIComponent(a.id)}`)}
                menu={[
                  { id: 'chat', label: 'Start chat', onSelect: () => navigate(`/chat?agent=${encodeURIComponent(a.id)}`) },
                  { id: 'edit', label: 'Edit', onSelect: () => useAgentsStore.getState().openEdit(a.id) },
                  { id: 'duplicate', label: 'Duplicate', onSelect: () => void useAgentsStore.getState().duplicate(a.id) },
                  { id: 'export', label: 'Export JSON', onSelect: () => void useAgentsStore.getState().exportAgent(a.id) },
                  { id: 'delete', label: 'Delete…', danger: true, separatorBefore: true, onSelect: () => useAgentsStore.getState().requestDelete(a.id) },
                ]}
              />
            ))}
      </div>
    </div>
  );
}

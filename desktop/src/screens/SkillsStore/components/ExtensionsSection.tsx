/*
 * Installed-view extensions (Phase 20 §11–12): MCP servers and plugins.
 * Both are engine-managed through their existing routes. Pin/drift uses the
 * SEC-01 pins API; a drift diff is shown, never auto-approved.
 */
import { Pin, PinOff, Plug, Puzzle, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Switch } from '@/components/ui/switch';
import { useSkillsStore } from '@/stores/skillsStore';
import type { McpPinDrift, McpServer } from '@/skills/core';
import type { PluginRow } from '@/skills/api';

export function McpCard({ server, index }: { server: McpServer; index: number }) {
  const toggle = useSkillsStore((s) => s.toggleMcp);
  const remove = useSkillsStore((s) => s.removeMcp);
  const pin = useSkillsStore((s) => s.pinMcp);
  const unpin = useSkillsStore((s) => s.unpinMcp);
  const diff = useSkillsStore((s) => s.diffMcp);
  const [drift, setDrift] = useState<McpPinDrift | null>(null);
  const [checking, setChecking] = useState(false);
  const target = server.transport === 'stdio' ? [server.command, ...server.args].filter(Boolean).join(' ') : server.url;
  const healthy = server.health === 'healthy';
  return (
    <article className="sk-card" style={{ ['--i' as string]: index }} data-testid={`mcp-card-${server.id}`} aria-label={`${server.name}, MCP server`}>
      <div className="sk-card-top">
        <span className="sk-icon" style={{ background: '#4A6FA5' }} aria-hidden="true">
          <Plug size={22} strokeWidth={1.5} />
        </span>
        <span className="sk-chip" data-muted={healthy ? undefined : 'true'} style={healthy ? { color: 'var(--success)' } : undefined}>
          {server.enabled ? server.health : 'disabled'}
        </span>
      </div>
      <div style={{ minWidth: 0 }}>
        <h3 className="sk-card-name">{server.name}</h3>
        <div className="sk-publisher">
          <span className="sk-chip">MCP · {server.transport}</span>
          <span className="sk-chip" data-muted="true">trust: {server.trust}</span>
        </div>
      </div>
      <code className="sk-hint" style={{ overflowWrap: 'anywhere', fontSize: 11 }}>{target || '—'}</code>
      {drift ? (
        <div className="sk-notice" data-tone={drift.status === 'drift' ? 'warn' : undefined} role="status" data-testid={`drift-${server.id}`}>
          <div className="sk-notice-body">
            {drift.status === 'unpinned' ? 'Not pinned yet.' : drift.status === 'match' ? 'Contract matches the pin.' : 'Tool contract changed since it was pinned — re-approve after review.'}
            {drift.status === 'drift' ? (
              <ul className="sk-hint" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {drift.changed.map((c) => <li key={c.tool}>{c.tool}: description changed</li>)}
                {drift.added.map((t) => <li key={`a-${t}`}>{t}: new tool</li>)}
                {drift.removed.map((t) => <li key={`r-${t}`}>{t}: removed</li>)}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="sk-card-foot" style={{ flexWrap: 'wrap' }}>
        <label className="sk-perm-ctl" style={{ gap: 6 }}>
          <Switch checked={server.enabled} onCheckedChange={(v) => void toggle(server.id, v)} aria-label={`Enable ${server.name}`} />
          {server.enabled ? 'On' : 'Off'}
        </label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button type="button" className="sk-btn sk-btn--ghost" onClick={() => void pin(server.id)} aria-label={`Pin contract for ${server.name}`}>
            <Pin size={13} strokeWidth={1.5} aria-hidden="true" /> Pin
          </button>
          <button
            type="button"
            className="sk-btn sk-btn--ghost"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              setDrift(await diff(server.id));
              setChecking(false);
            }}
            aria-label={`View drift for ${server.name}`}
          >
            <RefreshCw size={13} strokeWidth={1.5} aria-hidden="true" /> Drift
          </button>
          <button type="button" className="sk-btn sk-btn--ghost" onClick={() => void unpin(server.id)} aria-label={`Unpin contract for ${server.name}`}>
            <PinOff size={13} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button type="button" className="sk-btn sk-btn--danger" onClick={() => void remove(server.id)} aria-label={`Remove ${server.name}`}>
            <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function PluginCard({ plugin, index }: { plugin: PluginRow; index: number }) {
  const toggle = useSkillsStore((s) => s.togglePlugin);
  const grant = useSkillsStore((s) => s.grantPluginPermission);
  const sandboxed = plugin.sandboxed !== false;
  return (
    <article className="sk-card" style={{ ['--i' as string]: index }} data-testid={`plugin-card-${plugin.id}`} aria-label={`${plugin.name}, plugin`}>
      <div className="sk-card-top">
        <span className="sk-icon" style={{ background: '#5B6BD8' }} aria-hidden="true">
          <Puzzle size={22} strokeWidth={1.5} />
        </span>
        {sandboxed ? <span className="sk-chip" style={{ color: 'var(--success)' }}>sandboxed</span> : <span className="sk-chip" data-muted="true">in-process</span>}
      </div>
      <div style={{ minWidth: 0 }}>
        <h3 className="sk-card-name">{plugin.name}</h3>
        <div className="sk-publisher"><span className="sk-chip">plugin · v{plugin.version}</span></div>
      </div>
      <p className="sk-card-desc">{plugin.description}</p>
      {plugin.permissions?.length ? (
        <div className="sk-chips">
          {plugin.permissions.map((p) => (
            <label key={p.scope} className="sk-chip" data-danger={p.dangerous ? 'true' : undefined} style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={p.granted}
                onChange={(e) => void grant(plugin.id, p.scope, e.target.checked)}
                aria-label={`Grant plugin permission ${p.scope}`}
              />
              {p.scope}
            </label>
          ))}
        </div>
      ) : null}
      <div className="sk-card-foot">
        <label className="sk-perm-ctl" style={{ gap: 6 }}>
          <Switch checked={plugin.enabled} onCheckedChange={(v) => void toggle(plugin.id, v)} aria-label={`Enable ${plugin.name}`} />
          {plugin.enabled ? 'Enabled' : 'Disabled'}
        </label>
      </div>
    </article>
  );
}

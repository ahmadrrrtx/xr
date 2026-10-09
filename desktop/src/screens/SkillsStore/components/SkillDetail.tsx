/*
 * Skill detail slide-over (Phase 20 §9) — 480px, right edge.
 * Tabs: Overview · Permissions · Versions · Configure · Changelog.
 * Every state change is an engine call; dangerous grants go through the
 * human-only approval queue first (Shield gate).
 */
import { AlertDialog as AD } from 'radix-ui';
import { ArrowUpCircle, Check, Play, ShieldCheck, Trash2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Switch } from '@/components/ui/switch';
import { requestPermissionGrant } from '@/skills/quarantineApproval';
import { auditSkill } from '@/skills/audit';
import { useSkillsStore } from '@/stores/skillsStore';
import { QUARANTINE_COPY, TRUST_DETAIL, trustOf, typeLabel, type SkillRecord, type WireSetting } from '@/skills/core';
import type { InspectResponse } from '@/skills/api';

import { PermissionRow, SkillIcon, Stars, TrustBadge, VerifiedCheck } from './primitives';

type Tab = 'overview' | 'permissions' | 'versions' | 'configure' | 'changelog';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'versions', label: 'Versions' },
  { id: 'configure', label: 'Configure' },
  { id: 'changelog', label: 'Changelog' },
];

export function SkillDetail({ records }: { records: SkillRecord[] }) {
  const selectedId = useSkillsStore((s) => s.selectedId);
  if (!selectedId) return null;
  // Keyed by id: switching skills remounts the panel, resetting tab + confirms.
  return <SkillPanel key={selectedId} selectedId={selectedId} records={records} />;
}

function SkillPanel({ selectedId, records }: { selectedId: string; records: SkillRecord[] }) {
  const inspect = useSkillsStore((s) => s.inspect);
  const loading = useSkillsStore((s) => s.inspectLoading);
  const close = useSkillsStore((s) => s.closeDetail);
  const openInstall = useSkillsStore((s) => s.openInstall);
  const toggleEnabled = useSkillsStore((s) => s.toggleEnabled);
  const uninstall = useSkillsStore((s) => s.uninstall);
  const promote = useSkillsStore((s) => s.promote);
  const updates = useSkillsStore((s) => s.updates);
  const record = records.find((r) => r.id === selectedId) ?? null;
  const [tab, setTab] = useState<Tab>('overview');
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [confirmPromote, setConfirmPromote] = useState(false);
  const navigate = useNavigate();
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmUninstall && !confirmPromote) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, confirmUninstall, confirmPromote]);

  const current: SkillRecord | null = (inspect?.skill as SkillRecord | undefined) ?? record;
  const update = updates.find((u) => u.id === selectedId);
  const trust = current ? trustOf(current) : 'unsigned';
  const quarantined = Boolean(current?.quarantine.quarantined);

  return (
    <aside className="sk-slide" role="complementary" aria-labelledby={titleId} data-testid="skill-detail" tabIndex={-1}>
      <header className="sk-dialog-head" style={{ alignItems: 'flex-start' }}>
        {current ? <SkillIcon record={current} size="lg" /> : <span className="sk-icon" data-size="lg" style={{ background: 'var(--bg-raised)' }} aria-hidden="true" />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 id={titleId} className="sk-h" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {current?.name ?? selectedId}
          </h2>
          <p className="sk-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {current?.publisher ?? '—'}
            <VerifiedCheck level={trust} />
            <TrustBadge level={trust} />
          </p>
          {current ? (
            <p className="sk-hint" style={{ marginTop: 4 }}>
              v{current.version} · {typeLabel(current.skillType)}
              {current.installed ? ' · installed' : ''}
            </p>
          ) : null}
        </div>
        <button type="button" className="sk-close" onClick={close} aria-label="Close skill details" data-testid="detail-close">
          <X size={16} strokeWidth={1.5} />
        </button>
      </header>

      <div className="sk-tabs" role="tablist" aria-label="Skill sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className="sk-tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.id === tab);
              if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length].id);
              if (e.key === 'ArrowLeft') setTab(TABS[(i - 1 + TABS.length) % TABS.length].id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="sk-dialog-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ flex: 1 }}>
        {!current && loading ? <p className="sk-sub">Loading…</p> : null}
        {!current && !loading ? <p className="sk-sub">This skill is not in the current listing.</p> : null}
        {current && tab === 'overview' ? <Overview record={current} /> : null}
        {current && tab === 'permissions' ? (
          <PermissionsTab record={current} inspect={inspect} />
        ) : null}
        {current && tab === 'versions' ? <VersionsTab record={current} latest={update?.latestVersion} /> : null}
        {current && tab === 'configure' ? <ConfigureTab key={`${current.id}:${JSON.stringify(current.settingsValues ?? {})}`} record={current} /> : null}
        {current && tab === 'changelog' ? <Changelog record={current} changelog={update?.changelog ?? current.changelog ?? null} latest={update?.latestVersion} /> : null}
      </div>

      {current ? (
        <footer className="sk-slide-foot">
          {current.installed ? (
            <>
              <label className="sk-toggle-row" style={{ marginRight: 'auto' }}>
                <span>{current.enabled ? 'Enabled' : 'Disabled'}</span>
                <Switch
                  checked={current.enabled}
                  onCheckedChange={() => void toggleEnabled(current.id)}
                  aria-label={`Enable ${current.name}`}
                  data-testid="detail-toggle"
                />
              </label>
              {quarantined ? (
                <button type="button" className="sk-btn" onClick={() => setConfirmPromote(true)} data-testid="detail-promote">
                  <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" /> Promote from quarantine
                </button>
              ) : null}
              {update ? (
                <button type="button" className="sk-btn sk-btn--warn" onClick={() => openInstall(current.id, 'update')} data-testid="detail-update">
                  <ArrowUpCircle size={14} strokeWidth={1.75} aria-hidden="true" /> Update to {update.latestVersion}
                </button>
              ) : null}
              <button type="button" className="sk-btn sk-btn--danger" onClick={() => setConfirmUninstall(true)} data-testid="detail-uninstall">
                <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" /> Uninstall
              </button>
            </>
          ) : (
            <button type="button" className="sk-btn sk-btn--primary" onClick={() => openInstall(current.id)} data-testid="detail-install">
              Install
            </button>
          )}
          <button
            type="button"
            className="sk-btn sk-btn--ghost"
            onClick={() => {
              const hint = current.activation.phrases[0] ?? current.name;
              close();
              navigate(`/chat?prompt=${encodeURIComponent(`Try using the ${current.name} skill: ${hint}`)}`);
            }}
            disabled={!current.installed || !current.enabled}
            data-testid="detail-test"
          >
            <Play size={14} strokeWidth={1.75} aria-hidden="true" /> Test
          </button>
          <button type="button" className="sk-btn sk-btn--ghost" onClick={close}>
            Close
          </button>
        </footer>
      ) : null}

      <ConfirmDialog
        open={confirmUninstall}
        title={`Uninstall ${current?.name ?? selectedId}?`}
        body="This removes its files and revokes all permissions. Its settings are kept only if you reinstall."
        confirmLabel="Confirm uninstall"
        danger
        onCancel={() => setConfirmUninstall(false)}
        onConfirm={async () => {
          setConfirmUninstall(false);
          if (current) auditSkill('Skill uninstalled', current);
          await uninstall(selectedId);
        }}
      />
      <ConfirmDialog
        open={confirmPromote}
        title={`Promote ${current?.name ?? selectedId} out of quarantine?`}
        body={`${QUARANTINE_COPY.limits.join('; ')}. Promoting lifts these limits and applies the permissions you approved during quarantine.`}
        confirmLabel="Promote"
        onCancel={() => setConfirmPromote(false)}
        onConfirm={async () => {
          setConfirmPromote(false);
          if (current) auditSkill('Skill promoted from quarantine', current, { note: 'user confirmed' });
          await promote(selectedId);
        }}
      />
    </aside>
  );
}

function Overview({ record }: { record: SkillRecord }) {
  const trust = trustOf(record);
  const body = record.longDescription ?? record.description;
  const phrases = record.activation.phrases.slice(0, 4);
  const slash = record.activation.slashCommands.slice(0, 4);
  return (
    <>
      <div className="sk-md" data-testid="detail-overview">
        {body.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
      <dl className="sk-kv">
        <dt>Installs</dt>
        <dd>{record.source === 'bundled' ? 'Bundled with XR' : record.downloads.toLocaleString()}</dd>
        <dt>Rating</dt>
        <dd><Stars average={record.rating.average} count={record.rating.count} /></dd>
        <dt>Categories</dt>
        <dd>{record.categories.join(', ')}</dd>
        <dt>Updated</dt>
        <dd>{record.updatedAt ? new Date(record.updatedAt).toLocaleDateString() : record.installedAt ? new Date(record.installedAt).toLocaleDateString() : 'Bundled'}</dd>
        <dt>Source</dt>
        <dd>{record.source === 'bundled' ? 'Bundled with XR (offline catalog)' : record.registryId ? `Registry · ${record.registryId}` : record.source}</dd>
        {record.homepage ? (
          <>
            <dt>Homepage</dt>
            <dd>{record.homepage}</dd>
          </>
        ) : null}
      </dl>
      <div className="sk-notice" data-tone={trust === 'unsigned' ? 'danger' : undefined} style={{ margin: 0 }}>
        <ShieldCheck size={16} strokeWidth={1.5} aria-hidden="true" />
        <div className="sk-notice-body">
          <strong>{trust === 'unsigned' ? 'Unsigned — use caution' : trust}</strong>
          <div className="sk-hint" style={{ marginTop: 2 }}>{TRUST_DETAIL[trust]}</div>
        </div>
      </div>
      {phrases.length || slash.length ? (
        <section className="sk-section-block">
          <h3 className="sk-section-title">Get started</h3>
          <ul className="sk-sub" style={{ margin: 0, paddingLeft: 18 }}>
            {slash.map((s) => <li key={s}>Slash command <code>/{s}</code></li>)}
            {phrases.map((p) => <li key={p}>Ask XR: “{p}”</li>)}
          </ul>
        </section>
      ) : null}
      {record.dependencies.length ? (
        <section className="sk-section-block">
          <h3 className="sk-section-title">Dependencies</h3>
          <ul className="sk-sub" style={{ margin: 0, paddingLeft: 18 }}>
            {record.dependencies.map((d) => {
              const missing = d.kind === 'skill' && !d.optional;
              return (
                <li key={`${d.kind}:${d.id}`}>
                  {d.kind}:{d.id}{d.optional ? ' (optional)' : ''}{' '}
                  {missing ? <span style={{ color: 'var(--warning)' }}>— required</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {record.warnings.length || record.errors.length ? (
        <div className="sk-notice" data-tone="warn" role="note">
          <div className="sk-notice-body">
            {[...record.errors, ...record.warnings].map((w) => <div key={w}>{w}</div>)}
          </div>
        </div>
      ) : null}
    </>
  );
}

function PermissionsTab({ record, inspect }: { record: SkillRecord; inspect: InspectResponse | null }) {
  const grantPermissions = useSkillsStore((s) => s.grantPermissions);
  const granted = new Set(record.grantedPermissions);
  const quarantined = record.quarantine.quarantined;
  const pending = new Set(record.quarantine.pendingGrants);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = async (scope: string, next: boolean, dangerous: boolean) => {
    setNotice(null);
    if (!record.installed) return;
    if (!next) {
      await grantPermissions(record.id, [], [scope]);
      auditSkill('Skill permission revoked', record, { scopes: [scope] });
      return;
    }
    if (dangerous) {
      setBusy(scope);
      const decision = await requestPermissionGrant(record, scope, quarantined);
      setBusy(null);
      if (decision.status !== 'approved') {
        setNotice(`Not granted: ${scope} stays off.`);
        return;
      }
      await grantPermissions(record.id, [scope], []);
      auditSkill('Skill permission granted', record, { scopes: [scope], decision: 'allowed', note: quarantined ? 'parked until promotion' : 'effective now' });
      return;
    }
    await grantPermissions(record.id, [scope], []);
    auditSkill('Skill permission granted', record, { scopes: [scope] });
  };

  return (
    <>
      <p className="sk-hint">
        Permissions are declarations. Safe ones are granted automatically; high-risk ones need your approval every time you change them.
      </p>
      {quarantined ? (
        <div className="sk-notice" data-tone="warn" role="note">
          <ShieldCheck size={16} strokeWidth={1.5} aria-hidden="true" />
          <div className="sk-notice-body">
            Quarantined. Approved high-risk permissions are recorded but take effect after you promote the skill.
          </div>
        </div>
      ) : null}
      {notice ? <div className="sk-error" role="status">{notice}</div> : null}
      <div className="sk-section-block" style={{ gap: 6 }}>
        {record.permissions.map((p) => {
          const dangerous = p.dangerous || ['secrets', 'shell', 'control', 'computer:act', 'computer:read-screen', 'fs:write', 'browser', 'skill:install', 'skill:publish'].includes(p.scope);
          const on = granted.has(p.scope) || (quarantined && pending.has(p.scope));
          return (
            <div key={p.scope} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <PermissionRow
                permission={p}
                granted={on}
                disabled={!record.installed || busy === p.scope}
                controlLabel={`Grant permission to ${p.scope}`}
                onToggle={record.installed ? (next) => void toggle(p.scope, next, dangerous) : undefined}
              />
              {quarantined && pending.has(p.scope) ? <span className="sk-hint" style={{ paddingLeft: 40 }}>Approved — takes effect on promotion.</span> : null}
            </div>
          );
        })}
      </div>
      {!record.installed ? <p className="sk-hint">Install the skill to change its permissions.</p> : null}
      {inspect?.permissions?.missingApproval?.length ? (
        <p className="sk-hint" style={{ color: 'var(--warning)' }}>
          {inspect.permissions.missingApproval.length} high-risk permission{inspect.permissions.missingApproval.length > 1 ? 's' : ''} still need approval.
        </p>
      ) : null}
    </>
  );
}

function VersionsTab({ record, latest }: { record: SkillRecord; latest?: string }) {
  return (
    <section className="sk-section-block">
      <div className="sk-toggle-row">
        <span>
          <Check size={13} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--accent)', marginRight: 4 }} />
          v{record.version} <span className="sk-hint">(installed)</span>
        </span>
      </div>
      {latest && latest !== record.version ? (
        <div className="sk-toggle-row">
          <span>v{latest} <span className="sk-hint">(latest in registry)</span></span>
        </div>
      ) : null}
      <p className="sk-hint">
        The registry index exposes the current version per skill. Full version history and yank notices appear here when the registry publishes them.
      </p>
    </section>
  );
}

function ConfigureTab({ record }: { record: SkillRecord }) {
  const save = useSkillsStore((s) => s.saveSkillSettings);
  const settings: WireSetting[] = record.settings ?? [];
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...record.settingsValues }));
  const [error, setError] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(record.settingsValues ?? {}), [values, record.settingsValues]);

  if (!settings.length) return <p className="sk-sub">This skill has no settings to configure.</p>;

  const setVal = (key: string, v: unknown) => setValues((prev) => ({ ...prev, [key]: v }));

  return (
    <form
      className="sk-section-block"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const missing = settings.find((s) => s.required && (values[s.key] === undefined || values[s.key] === ''));
        if (missing) {
          setError(`${missing.title} is required.`);
          return;
        }
        await save(record.id, values);
      }}
    >
      {settings.map((s) => {
        const id = `set-${s.key}`;
        const v = values[s.key];
        if (s.type === 'boolean') {
          return (
            <label key={s.key} className="sk-toggle-row" htmlFor={id}>
              <span>
                {s.title}
                {s.description ? <span className="sk-hint" style={{ display: 'block' }}>{s.description}</span> : null}
              </span>
              <Switch id={id} checked={Boolean(v ?? s.default ?? false)} onCheckedChange={(c) => setVal(s.key, c)} />
            </label>
          );
        }
        if (s.type === 'enum') {
          return (
            <label key={s.key} className="sk-field" htmlFor={id}>
              <span className="sk-label">{s.title}{s.required ? ' *' : ''}</span>
              <select id={id} className="sk-input" value={String(v ?? s.default ?? '')} onChange={(e) => setVal(s.key, e.target.value)}>
                <option value="">—</option>
                {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              {s.description ? <span className="sk-hint">{s.description}</span> : null}
            </label>
          );
        }
        if (s.type === 'number') {
          return (
            <label key={s.key} className="sk-field" htmlFor={id}>
              <span className="sk-label">{s.title}{s.required ? ' *' : ''}</span>
              <input id={id} type="number" className="sk-input" value={v === undefined ? '' : String(v)} onChange={(e) => setVal(s.key, e.target.value === '' ? undefined : Number(e.target.value))} />
              {s.description ? <span className="sk-hint">{s.description}</span> : null}
            </label>
          );
        }
        return (
          <label key={s.key} className="sk-field" htmlFor={id}>
            <span className="sk-label">{s.title}{s.required ? ' *' : ''}</span>
            <input
              id={id}
              type={s.type === 'secret' ? 'password' : 'text'}
              autoComplete="off"
              className="sk-input"
              value={v === undefined ? '' : String(v)}
              onChange={(e) => setVal(s.key, e.target.value)}
            />
            <span className="sk-hint">{s.type === 'secret' ? 'Stored locally with the skill settings. Values are never logged.' : s.description}</span>
          </label>
        );
      })}
      {error ? <p className="sk-error" role="alert">{error}</p> : null}
      <div>
        <button type="submit" className="sk-btn sk-btn--primary" disabled={!dirty} data-testid="settings-save">Save settings</button>
      </div>
    </form>
  );
}

function Changelog({ record, changelog, latest }: { record: SkillRecord; changelog: string | null; latest?: string }) {
  return (
    <div className="sk-md" data-testid="detail-changelog">
      <h3>{latest ? `v${latest} — available` : `v${record.version} — installed`}</h3>
      {changelog ? changelog.split(/\n{2,}/).map((p, i) => <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</p>) : <p>No changelog published for this version.</p>}
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const id = useId();
  return (
    <AD.Root open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AD.Portal>
        <AD.Overlay className="sk-overlay" />
        <AD.Content className="sk-dialog" data-size="narrow" aria-labelledby={id} aria-describedby={`${id}-d`}>
          <div className="sk-dialog-body" style={{ paddingTop: 20 }}>
            <AD.Title id={id} className="sk-h">{title}</AD.Title>
            <AD.Description id={`${id}-d`} className="sk-sub">{body}</AD.Description>
          </div>
          <footer className="sk-dialog-foot">
            <AD.Cancel asChild>
              <button type="button" className="sk-btn sk-btn--ghost" autoFocus>Cancel</button>
            </AD.Cancel>
            <button type="button" className={danger ? 'sk-btn sk-btn--danger' : 'sk-btn sk-btn--primary'} onClick={() => void onConfirm()} data-testid="confirm-action">
              {confirmLabel}
            </button>
          </footer>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}


/*
 * Install / update / install-from-URL dialog (Phase 20 §8 + §10).
 *
 * role="alertdialog" (Radix), focus-trapped, Esc cancels (blocked while an
 * install is running so the stream can settle). Quarantine is ON by default;
 * the engine forces it for unsigned / untrusted sources and refuses an
 * opt-out — this dialog only mirrors that rule so the UI is never misleading.
 */
import { AlertDialog as AD } from 'radix-ui';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Link2,
  ShieldAlert,
  X,
  FolderOpen,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { Switch } from '@/components/ui/switch';
import { useSkillsStore } from '@/stores/skillsStore';
import {
  isTrustedPublisher,
  QUARANTINE_COPY,
  TRUST_DETAIL,
  trustOf,
  type SkillRecord,
} from '@/skills/core';

import { PermissionRow, SkillIcon, TrustBadge } from './primitives';

const STEPS: Array<{ id: 'download' | 'verify' | 'install' | 'validate' | 'ready'; label: string }> = [
  { id: 'download', label: 'Downloading' },
  { id: 'verify', label: 'Verifying signature' },
  { id: 'install', label: 'Installing to ~/xr/skills/' },
  { id: 'validate', label: 'Validating manifest & dependencies' },
  { id: 'ready', label: 'Ready' },
];

export function InstallModal({ records }: { records: SkillRecord[] }) {
  const d = useSkillsStore((s) => s.install);
  const close = useSkillsStore((s) => s.closeInstall);
  const set = useSkillsStore((s) => s.setInstallField);
  const confirm = useSkillsStore((s) => s.confirmInstall);
  const retry = useSkillsStore((s) => s.retryInstall);
  const setSource = useSkillsStore((s) => s.setInstallSource);
  const toggleGrant = useSkillsStore((s) => s.toggleGrant);
  const updates = useSkillsStore((s) => s.updates);
  const grantSafe = d.grantSafe;

  const navigate = useNavigate();
  const titleId = useId();
  const descId = useId();
  const sourceRef = useRef<HTMLInputElement | null>(null);

  const record = useMemo(() => records.find((r) => r.id === d.skillId) ?? null, [records, d.skillId]);
  const manifest = d.mode === 'from-url' ? d.preview?.manifest ?? null : record;
  const trust = d.mode === 'from-url' && d.preview
    ? trustOf({ verification: d.preview.manifest?.verification.level ?? 'unverified', signed: Boolean(d.preview.manifest?.verification.signature), source: 'local' })
    : record
      ? trustOf(record)
      : 'unsigned';
  // Engine rule (skill-service.installWithProgress): unsigned or untrusted
  // sources are forced into quarantine and cannot opt out.
  const forced = d.mode === 'from-url' ? Boolean(d.preview?.decision.forced) : trust === 'unsigned';
  const forcedReason = d.mode === 'from-url' ? d.preview?.decision.detail : trust === 'unsigned' ? QUARANTINE_COPY.offWarning : undefined;
  const permissions = (manifest?.permissions ?? []) as SkillRecord['permissions'];
  const dependencies = (manifest?.dependencies ?? []) as SkillRecord['dependencies'];
  const missingDeps = dependencies.filter((dep) => !dep.optional && dep.kind === 'skill' && !records.some((r) => r.id === dep.id && r.installed));
  const update = d.mode === 'update' ? updates.find((u) => u.id === d.skillId) : undefined;
  const quarantineOn = d.quarantineOn || forced;

  const busy = d.busy;
  const step = d.step;

  // Dangerous grants default ON only for trusted publishers with quarantine on
  // (brief §8). Parked in quarantine until promotion — the copy says so.
  useEffect(() => {
    if (!d.open || step !== 'form' || !manifest) return;
    const trustedNow = d.mode === 'from-url' ? false : isTrustedPublisher(trust);
    const defaults = new Set(trustedNow && quarantineOn ? permissions.filter((p) => p.dangerous).map((p) => p.scope) : []);
    if (defaults.size !== d.grantDangerous.size || [...defaults].some((s) => !d.grantDangerous.has(s))) {
      set({ grantDangerous: defaults });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per open skill
  }, [d.open, d.skillId, d.mode, step, manifest?.id]);

  useEffect(() => {
    if (d.open && d.mode === 'from-url' && step === 'form') setTimeout(() => sourceRef.current?.focus(), 30);
  }, [d.open, d.mode, step]);

  if (!d.open) return null;

  const title =
    d.mode === 'update' ? `Update to ${update?.latestVersion ?? manifest?.version ?? ''}` : d.mode === 'from-url' ? 'Install from URL or folder' : 'Install skill';

  const onQuarantineChange = (on: boolean) => {
    if (forced && !on) return;
    const next: Partial<typeof d> = { quarantineOn: on };
    if (!on) next.grantDangerous = new Set();
    set(next);
  };

  const goTest = () => {
    const name = manifest?.name ?? d.skillId ?? 'this skill';
    close();
    const hint = (manifest?.activation?.phrases?.[0] ?? name).replace(/\s+/g, ' ').trim();
    navigate(`/chat?prompt=${encodeURIComponent(`Try using the ${name} skill: ${hint}`)}`);
  };

  const showProgress = step === 'progress' || step === 'success' || step === 'error';
  const doneSteps = new Set(d.events.filter((e) => e.type === 'step' && e.pct >= 100).map((e) => e.step));
  if (step === 'success') doneSteps.add('ready');
  const activeIdx = STEPS.findIndex((s) => s.id === d.activeStep);

  const canSubmit =
    !busy &&
    (d.mode === 'from-url' ? Boolean(d.preview?.ok && d.preview.manifest) : Boolean(record || update));

  return (
    <AD.Root open onOpenChange={(o) => { if (!o) close(); }}>
      <AD.Portal>
        <AD.Overlay className="sk-overlay" />
        <AD.Content
          className="sk-dialog"
          aria-labelledby={titleId}
          aria-describedby={descId}
          data-testid="install-modal"
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <header className="sk-dialog-head">
            {manifest ? (
              <SkillIcon record={{ id: manifest.id, name: manifest.name, tags: (manifest as SkillRecord).tags ?? [], categories: manifest.categories ?? [] }} size="lg" />
            ) : (
              <span className="sk-icon" data-size="lg" style={{ background: 'var(--bg-raised)', color: 'var(--text-tertiary)' }} aria-hidden="true">
                <Link2 size={22} strokeWidth={1.5} />
              </span>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <AD.Title id={titleId} className="sk-h">
                {title}
              </AD.Title>
              <p className="sk-sub" style={{ marginTop: 2 }}>
                {manifest ? (
                  <>
                    <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{manifest.name}</strong>
                    {' · '}
                    {manifest.publisher}
                    {' '}
                    <TrustBadge level={trust} />
                  </>
                ) : (
                  'Paste a package URL, git repository or local folder.'
                )}
              </p>
            </div>
            <button type="button" className="sk-close" onClick={close} disabled={busy} aria-label="Close install dialog">
              <X size={16} strokeWidth={1.5} />
            </button>
          </header>
          <AD.Description id={descId} className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {showProgress
              ? 'Installation progress. Steps are announced as they complete.'
              : 'Review the permissions and quarantine setting, then install.'}
          </AD.Description>

          <div className="sk-dialog-body">
            {/* ── from-url source ─────────────────────────────────────── */}
            {d.mode === 'from-url' && step === 'form' ? (
              <form
                className="sk-section-block"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = String(new FormData(e.currentTarget).get('source') ?? '').trim();
                  if (!v) return;
                  const isUrl = /^(https?:|git@|github:)/i.test(v);
                  setSource(isUrl ? { url: v } : { localPath: v });
                }}
              >
                <label className="sk-field">
                  <span className="sk-label">Package URL, git repository or local folder</span>
                  <input
                    ref={sourceRef}
                    name="source"
                    className="sk-input"
                    placeholder="https://…/skill.xrs · github:owner/repo · /path/to/skill"
                    defaultValue={d.source?.url ?? d.source?.localPath ?? ''}
                    aria-describedby="source-hint"
                    data-testid="install-source"
                  />
                  <span id="source-hint" className="sk-hint">
                    XR downloads or reads the source, checks the manifest and signature, then shows you what it asks for. Nothing is installed yet.
                  </span>
                </label>
                <div>
                  <button type="submit" className="sk-btn" disabled={busy}>
                    {busy ? <Loader2 size={14} className="sk-spin" aria-hidden="true" /> : <FolderOpen size={14} aria-hidden="true" />}
                    Check source
                  </button>
                </div>
              </form>
            ) : null}

            {d.error && step === 'form' ? (
              <div className="sk-notice" data-tone="danger" role="alert">
                <ShieldAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                <div className="sk-notice-body">{d.error}</div>
              </div>
            ) : null}

            {d.mode === 'from-url' && d.preview?.warnings?.length && step === 'form' ? (
              <ul className="sk-hint" style={{ margin: 0, paddingLeft: 18 }}>
                {d.preview.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            ) : null}

            {/* ── form body (registry skill or validated source) ──────── */}
            {manifest && step === 'form' ? (
              <>
                <section className="sk-section-block" aria-labelledby="sec-about">
                  <h3 id="sec-about" className="sk-section-title">About</h3>
                  <p className="sk-sub" style={{ color: 'var(--text-primary)' }}>{manifest.description}</p>
                  {update?.changelog ? (
                    <div className="sk-notice" data-tone="warn">
                      <div className="sk-notice-body">
                        <strong>What changed in {update.latestVersion}</strong>
                        <p className="sk-sub" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{update.changelog}</p>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="sk-section-block" aria-labelledby="sec-trust">
                  <h3 id="sec-trust" className="sk-section-title">Publisher</h3>
                  <div className="sk-kv">
                    <dt>Publisher</dt>
                    <dd>{manifest.publisher}</dd>
                    <dt>Trust</dt>
                    <dd>
                      <TrustBadge level={trust} />{' '}
                      <span className="sk-hint">{TRUST_DETAIL[trust]}</span>
                    </dd>
                    {record?.signed || (d.mode === 'from-url' && d.preview?.manifest?.verification.signature) ? (
                      <>
                        <dt>Signature</dt>
                        <dd>
                          Verified package signature. Checked again on install.
                        </dd>
                      </>
                    ) : null}
                  </div>
                  {trust === 'unsigned' ? (
                    <div className="sk-unsigned" role="note" data-testid="unsigned-warning">
                      <AlertTriangle size={18} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--danger)', flexShrink: 0 }} />
                      <div>
                        <strong>Unsigned — use caution.</strong> XR cannot verify who published this skill. Quarantine is required and cannot be turned off.
                        {d.mode === 'from-url' ? <div style={{ marginTop: 4 }}>This skill is not from the XR registry. Make sure you trust the source.</div> : null}
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="sk-section-block" aria-labelledby="sec-perms">
                  <h3 id="sec-perms" className="sk-section-title">
                    Permissions · {permissions.length} requested
                  </h3>
                  {permissions.length === 0 ? (
                    <p className="sk-sub">This skill does not request any permissions.</p>
                  ) : (
                    <>
                      <p className="sk-hint">
                        Safe permissions are granted when you install. High-risk permissions need your explicit approval
                        {quarantineOn ? ' — while quarantined they are recorded as approved and only take effect after you promote the skill.' : '.'}
                      </p>
                      <div className="sk-section-block" style={{ gap: 6 }}>
                        {permissions.map((p) => {
                          const dangerous = p.dangerous || ['secrets', 'shell', 'control', 'computer:act', 'computer:read-screen', 'fs:write', 'browser', 'skill:install', 'skill:publish'].includes(p.scope);
                          const granted = dangerous ? d.grantDangerous.has(p.scope) : grantSafe;
                          return (
                            <PermissionRow
                              key={p.scope}
                              permission={p}
                              granted={granted}
                              disabled={!dangerous}
                              controlLabel={`Grant permission to ${p.scope}`}
                              onToggle={dangerous ? () => toggleGrant(p.scope) : undefined}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                </section>

                <section className="sk-section-block" aria-labelledby="sec-quarantine">
                  <h3 id="sec-quarantine" className="sk-section-title">Quarantine</h3>
                  <div className="sk-quarantine" data-on={quarantineOn ? 'true' : 'false'}>
                    <div className="sk-quarantine-row">
                      <div className="sk-quarantine-title">
                        <ShieldAlert size={16} strokeWidth={1.5} aria-hidden="true" style={{ color: quarantineOn ? 'var(--accent)' : 'var(--warning)' }} />
                        <label htmlFor="quarantine-switch">{QUARANTINE_COPY.toggle}</label>
                        {quarantineOn ? <span className="sk-recommended">{QUARANTINE_COPY.recommend}</span> : null}
                      </div>
                      <Switch
                        id="quarantine-switch"
                        checked={quarantineOn}
                        disabled={forced || busy}
                        onCheckedChange={onQuarantineChange}
                        aria-describedby="quarantine-copy"
                        data-testid="quarantine-switch"
                      />
                    </div>
                    <div id="quarantine-copy">
                      {quarantineOn ? (
                        <>
                          <p className="sk-sub" style={{ color: 'var(--text-primary)' }}>
                            {forced ? QUARANTINE_COPY.summary + '. Required for this source.' : QUARANTINE_COPY.summary + '.'}
                          </p>
                          <p className="sk-sub" style={{ marginTop: 6 }}>While quarantined, this skill:</p>
                          <ul className="sk-limits">
                            {QUARANTINE_COPY.limits.map((l) => <li key={l}>{l}</li>)}
                          </ul>
                        </>
                      ) : (
                        <div className="sk-notice" data-tone="warn" role="note" style={{ margin: 0 }}>
                          <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
                          <div className="sk-notice-body">{QUARANTINE_COPY.offWarning}</div>
                        </div>
                      )}
                      {forced && forcedReason ? <p className="sk-hint" style={{ marginTop: 6 }}>{forcedReason}</p> : null}
                    </div>
                  </div>
                </section>

                {dependencies.length ? (
                  <section className="sk-section-block" aria-labelledby="sec-deps">
                    <h3 id="sec-deps" className="sk-section-title">Dependencies</h3>
                    <ul className="sk-sub" style={{ margin: 0, paddingLeft: 18 }}>
                      {dependencies.map((dep) => {
                        const missing = dep.kind === 'skill' && !records.some((r) => r.id === dep.id && r.installed);
                        return (
                          <li key={`${dep.kind}:${dep.id}`}>
                            {dep.kind}:{dep.id}{dep.optional ? ' (optional)' : ''}
                            {missing && !dep.optional ? <span style={{ color: 'var(--warning)' }}> — will be installed with this skill</span> : null}
                          </li>
                        );
                      })}
                    </ul>
                    {missingDeps.length ? (
                      <div className="sk-notice" data-tone="warn" role="note" style={{ margin: 0 }}>
                        <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
                        <div className="sk-notice-body">
                          Installs {missingDeps.length} additional package{missingDeps.length > 1 ? 's' : ''}: {missingDeps.map((m) => m.id).join(', ')}.
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <Advanced
                  open={d.advancedOpen}
                  onToggle={() => set({ advancedOpen: !d.advancedOpen })}
                  pin={d.pinContract}
                  onPin={(v) => set({ pinContract: v })}
                  location={`~/xr/skills/${manifest.id}/`}
                  trusted={isTrustedPublisher(trust)}
                />
              </>
            ) : null}

            {/* ── progress ───────────────────────────────────────────── */}
            {showProgress ? (
              <section className="sk-section-block" aria-live="polite" data-testid="install-progress">
                <div
                  className="sk-bar"
                  role="progressbar"
                  aria-label={`Install progress: ${STEPS[Math.max(0, activeIdx)]?.label ?? 'starting'}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(d.pct)}
                  aria-valuetext={`${Math.round(d.pct)}% — ${STEPS[Math.max(0, activeIdx)]?.label ?? 'starting'}`}
                >
                  <span style={{ width: `${Math.min(100, Math.max(0, d.pct))}%` }} />
                </div>
                <ol className="sk-steps">
                  {STEPS.map((s, i) => {
                    const done = doneSteps.has(s.id) && s.id !== 'ready' ? true : s.id === 'ready' ? step === 'success' : i < activeIdx;
                    const active = !done && i === activeIdx && step === 'progress';
                    const errored = step === 'error' && i === activeIdx;
                    const state = errored ? 'error' : done ? 'done' : active ? 'active' : 'pending';
                    return (
                      <li key={s.id} className="sk-step" data-state={state}>
                        <span className="sk-step-dot" aria-hidden="true">
                          {state === 'done' ? <Check size={12} strokeWidth={2.25} /> : active ? <Loader2 size={12} className="sk-spin" strokeWidth={2} /> : errored ? <X size={12} strokeWidth={2} /> : null}
                        </span>
                        <span>
                          {s.label}
                          {active && s.id === 'download' ? ` ${Math.round(d.pct)}%` : ''}
                          <span className="sk-step-sub">
                            {d.events.filter((e) => e.step === s.id).slice(-1)[0]?.message ?? ''}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}

            {step === 'error' ? (
              <div className="sk-notice" data-tone="danger" role="alert" data-testid="install-error">
                <ShieldAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                <div className="sk-notice-body">
                  <strong>Install failed.</strong> {d.error}
                  <details style={{ marginTop: 6 }}>
                    <summary>Details</summary>
                    <pre className="sk-hint" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
                      {JSON.stringify({ skill: d.skillId, error: d.error, warnings: d.result?.warnings ?? [], quarantineReason: d.result?.quarantineReason ?? null }, null, 2)}
                    </pre>
                  </details>
                </div>
              </div>
            ) : null}

            {step === 'success' ? (
              <div className="sk-success" data-testid="install-success">
                <span className="sk-success-mark" aria-hidden="true">
                  <Check size={28} strokeWidth={2.25} />
                </span>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>✓ Installed</p>
                <p className="sk-sub">
                  {d.result?.quarantined ? 'Installed in quarantine — available to agents, with your approval for each use.' : 'Available to agents now.'}
                </p>
                {d.result?.warnings?.length ? (
                  <ul className="sk-hint" style={{ margin: 0, textAlign: 'left' }}>
                    {d.result.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          <footer className="sk-dialog-foot">
            {step === 'form' ? (
              <>
                {!forced && !quarantineOn ? <span className="sk-foot-note">Not recommended — XR won’t sandbox this skill.</span> : null}
                <button type="button" className="sk-btn sk-btn--ghost" onClick={close} disabled={busy}>
                  Cancel
                </button>
                {canSubmit && !quarantineOn ? (
                  <button type="button" className="sk-btn sk-btn--warn" onClick={() => void confirm()} data-testid="install-normally">
                    Install normally
                  </button>
                ) : null}
                {canSubmit && quarantineOn ? (
                  <button type="button" className="sk-btn sk-btn--primary" onClick={() => void confirm()} data-testid="install-confirm" autoFocus={d.mode !== 'from-url'}>
                    {d.mode === 'update' ? `Update with quarantine` : 'Install with quarantine'}
                  </button>
                ) : null}
              </>
            ) : null}
            {step === 'progress' ? (
              <>
                <span className="sk-foot-note">{busy ? 'Working — the engine verifies every step.' : ''}</span>
              </>
            ) : null}
            {step === 'error' ? (
              <>
                <button type="button" className="sk-btn sk-btn--ghost" onClick={close}>Cancel</button>
                <button type="button" className="sk-btn" onClick={() => void retry()} data-testid="install-retry">Retry</button>
              </>
            ) : null}
            {step === 'success' ? (
              <>
                <button type="button" className="sk-btn sk-btn--ghost" onClick={close}>Close</button>
                <button type="button" className="sk-btn sk-btn--primary" onClick={goTest} data-testid="install-test">
                  Test it
                </button>
              </>
            ) : null}
          </footer>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

function Advanced({
  open,
  onToggle,
  pin,
  onPin,
  location,
  trusted,
}: {
  open: boolean;
  onToggle: () => void;
  pin: boolean;
  onPin: (v: boolean) => void;
  location: string;
  trusted: boolean;
}) {
  return (
    <section className="sk-section-block">
      <button type="button" className="sk-btn sk-btn--ghost" style={{ justifyContent: 'flex-start', padding: 0 }} aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        Advanced options
      </button>
      {open ? (
        <div className="sk-section-block" style={{ gap: 10 }}>
          <Field label="Install location">
            <code style={{ fontSize: 12 }}>{location}</code>
          </Field>
          <Field label="Pin this version">
            <div className="sk-toggle-row">
              <span className="sk-hint">Skip automatic updates for this skill. You can still update by hand.</span>
              <Switch checked={pin} onCheckedChange={onPin} aria-label="Pin this version" />
            </div>
          </Field>
          <Field label="Automatic updates">
            <span className="sk-hint">
              {trusted ? 'Available once the update scheduler ships. Updates always re-verify the signature.' : 'Off for unsigned and community skills. Updates always re-verify the signature.'}
            </span>
          </Field>
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sk-field">
      <span className="sk-label">{label}</span>
      {children}
    </div>
  );
}


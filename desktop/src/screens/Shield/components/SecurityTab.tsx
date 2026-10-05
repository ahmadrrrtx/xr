/*
 * Shield → Security Settings (Phase 12, SCREEN-BRIEFS §8 Tab 4). Grouped
 * policy rows, each carrying an honest Enforced / Planned badge (Constitution
 * Art. IV.2): a toggle that only persists says so in its row. Egress lists,
 * strictness, PII, quarantine, then the health + emergency cards again so
 * the whole trust surface is reachable from one scroll.
 */
import { ExternalLink, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/settings/dialogs';
import { Segmented, Toggle } from '@/components/settings/controls';
import { cn } from '@/lib/utils';
import { fmtAgo, isValidHostname } from '@/shield/core';
import {
  POLICY_META,
  type HealthCheck,
  type PolicyToggleKey,
  type QuarantinedSkill,
  type SecurityPolicy,
  type Strictness,
} from '@/shield/types';
import { useShieldStore } from '@/stores/shieldStore';

import { EnforcementBadge, ShieldCard } from './shared';
import { EmergencyCard, HealthCard } from './StatusTab';

interface Props {
  policy: SecurityPolicy;
  quarantine: QuarantinedSkill[];
  checks: HealthCheck[];
  lastCheckedAt: number | null;
  paused: boolean;
  now: number;
}

const STRICTNESS: { value: Strictness; label: string }[] = [
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'strict', label: 'Strict' },
];

export function SecurityTab({
  policy,
  quarantine,
  checks,
  lastCheckedAt,
  paused,
  now,
}: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const quarantineRef = useRef<HTMLElement>(null);
  const [trusting, setTrusting] = useState<QuarantinedSkill | null>(null);

  // `?section=quarantine` (from the Status tile) scrolls the section in.
  useEffect(() => {
    if (params.get('section') === 'quarantine')
      quarantineRef.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
  }, [params]);

  const set = (patch: Partial<SecurityPolicy>): void => {
    void useShieldStore.getState().setPolicy(patch);
  };

  const active = quarantine.filter((q) => q.status === 'quarantined');
  const resolved = quarantine.filter((q) => q.status !== 'quarantined');

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="shield-security-tab">
      {/* Approvals */}
      <ShieldCard title="Approvals" testId="policy-approvals">
        <PolicyRow id="autoApproveLowRisk" policy={policy} onChange={set} />
        <PolicyRow id="allowShellExec" policy={policy} onChange={set} />
        <PolicyRow
          id="biometricApproval"
          policy={policy}
          onChange={set}
          disabled={!policy.biometricSupported}
          unavailable={!policy.biometricSupported}
        />
        <Row
          label={POLICY_META.constitutionStrictness.label}
          description={POLICY_META.constitutionStrictness.description}
          badge={<EnforcementBadge enforcement="planned" />}
          note={POLICY_META.constitutionStrictness.note}
        >
          <Segmented
            value={policy.constitutionStrictness}
            options={STRICTNESS}
            onChange={(v) => set({ constitutionStrictness: v })}
            ariaLabel="Constitution strictness"
          />
        </Row>
      </ShieldCard>

      {/* Network */}
      <ShieldCard title="Network" testId="policy-network">
        <PolicyRow id="egressProxy" policy={policy} onChange={set} />
        <DomainList
          label="Allowed domains"
          description="Hosts agents may reach without a prompt once the proxy is live."
          values={policy.allowedDomains}
          onChange={(allowedDomains) => set({ allowedDomains })}
          testId="allowed-domains"
        />
        <DomainList
          label="Blocked domains"
          description="Hosts that will be refused outright."
          values={policy.blockedDomains}
          onChange={(blockedDomains) => set({ blockedDomains })}
          testId="blocked-domains"
        />
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="text-text-tertiary text-[12px]">
            Nothing is proxied in this build — the lists are stored for the day
            it is.
          </span>
          <button
            type="button"
            onClick={() => toast('Blocked attempts log coming in Phase 14.')}
            className="text-text-secondary hover:text-text-primary hover:bg-bg-raised h-7 shrink-0 cursor-pointer rounded-md px-2 text-[12px]"
          >
            View blocked attempts
          </button>
        </div>
      </ShieldCard>

      {/* Privacy */}
      <ShieldCard title="Privacy" testId="policy-privacy">
        <PolicyRow
          id="piiRedaction"
          policy={policy}
          onChange={set}
          extra={
            <button
              type="button"
              onClick={() => navigate('/settings#privacy')}
              className="text-accent hover:bg-bg-raised flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px]"
            >
              Configure patterns
              <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
            </button>
          }
        />
        <PolicyRow id="dataSharing" policy={policy} onChange={set} />
      </ShieldCard>

      {/* Quarantine */}
      <section ref={quarantineRef} id="quarantine" className="scroll-mt-4">
        <ShieldCard
          title={`Quarantine${active.length ? ` · ${active.length}` : ''}`}
          testId="policy-quarantine"
        >
          <PolicyRow id="quarantineNewSkills" policy={policy} onChange={set} />
          {active.length === 0 ? (
            <p className="text-text-tertiary px-4 py-3 text-[12px]">
              No skills are quarantined.
            </p>
          ) : (
            <ul className="divide-border-subtle divide-y">
              {active.map((q) => (
                <li
                  key={q.id}
                  data-testid="quarantined-skill"
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary text-[13px] font-medium">
                        {q.name}
                      </span>
                      <span className="text-text-tertiary font-mono text-[11px]">
                        {q.version}
                      </span>
                      <span className="text-text-tertiary text-[11px]">
                        · {q.source}
                      </span>
                    </div>
                    <p className="text-text-tertiary text-[12px] leading-relaxed">
                      {q.reason} · quarantined {fmtAgo(q.quarantinedAt, now)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void useShieldStore.getState().removeSkill(q.id)
                      }
                      data-testid="skill-remove"
                      className="text-text-secondary hover:text-danger hover:bg-danger/10 h-7 cursor-pointer rounded-md px-2 text-[12px]"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrusting(q)}
                      data-testid="skill-trust"
                      className="border-border-subtle text-text-primary hover:bg-bg-raised h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium"
                    >
                      Trust
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {resolved.length > 0 && (
            <p className="text-text-tertiary border-border-subtle border-t px-4 py-2 text-[11px]">
              {resolved.map((q) => `${q.name} (${q.status})`).join(' · ')}
            </p>
          )}
        </ShieldCard>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <HealthCard
          checks={checks}
          lastCheckedAt={lastCheckedAt}
          now={now}
          compact
        />
        <EmergencyCard paused={paused} />
      </div>

      <ConfirmDialog
        open={trusting !== null}
        onOpenChange={(o) => {
          if (!o) setTrusting(null);
        }}
        title={trusting ? `Trust ${trusting.name}?` : ''}
        body={
          trusting ? (
            <>
              {trusting.name} {trusting.version} leaves quarantine. Its requests
              follow your normal approval rules again, including any remember
              rules. This is recorded in the audit log.
            </>
          ) : null
        }
        confirmLabel="Trust skill"
        onConfirm={async () => {
          if (!trusting) return;
          const id = trusting.id;
          setTrusting(null);
          await useShieldStore.getState().trustSkill(id);
        }}
      />
    </div>
  );
}

/* ── Rows ──────────────────────────────────────────────────────────────── */

function Row({
  label,
  description,
  badge,
  note,
  children,
  htmlFor,
}: {
  label: string;
  description: string;
  badge: React.ReactNode;
  note?: string;
  children?: React.ReactNode;
  htmlFor?: string;
}) {
  const LabelTag = (htmlFor ? 'label' : 'div') as 'label';
  return (
    <div className="hover:bg-bg-raised/40 flex items-start justify-between gap-4 px-4 py-3 transition-colors">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <LabelTag
            htmlFor={htmlFor}
            className="text-text-primary text-[13px] font-medium"
          >
            {label}
          </LabelTag>
          {badge}
        </div>
        <p className="text-text-tertiary mt-0.5 text-[12px] leading-relaxed">
          {description}
        </p>
        {note && (
          <p className="text-text-tertiary/80 mt-0.5 text-[11px] leading-relaxed">
            {note}
          </p>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {children}
        </div>
      )}
    </div>
  );
}

function PolicyRow({
  id,
  policy,
  onChange,
  disabled,
  unavailable,
  extra,
}: {
  id: PolicyToggleKey;
  policy: SecurityPolicy;
  onChange: (patch: Partial<SecurityPolicy>) => void;
  disabled?: boolean;
  unavailable?: boolean;
  extra?: React.ReactNode;
}) {
  const meta = POLICY_META[id];
  const inputId = `policy-${id}`;
  return (
    <Row
      label={meta.label}
      description={meta.description}
      note={meta.note}
      htmlFor={inputId}
      badge={
        <EnforcementBadge
          enforcement={meta.enforcement}
          unavailable={unavailable}
        />
      }
    >
      {extra}
      <Toggle
        id={inputId}
        checked={policy[id]}
        disabled={disabled}
        onCheckedChange={(v) => onChange({ [id]: v })}
        ariaLabel={meta.label}
      />
    </Row>
  );
}

/* ── Domain list ───────────────────────────────────────────────────────── */

function DomainList({
  label,
  description,
  values,
  onChange,
  testId,
}: {
  label: string;
  description: string;
  values: string[];
  onChange: (next: string[]) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (): void => {
    const host = draft.trim().toLowerCase();
    if (!host) return;
    if (!isValidHostname(host)) {
      setError('Enter a hostname like api.example.com');
      return;
    }
    if (values.includes(host)) {
      setError('Already in the list');
      return;
    }
    onChange([...values, host]);
    setDraft('');
    setError(null);
  };

  return (
    <div className="px-4 py-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className="text-text-primary text-[13px] font-medium">
          {label}
        </span>
        <EnforcementBadge enforcement="planned" />
      </div>
      <p className="text-text-tertiary mt-0.5 text-[12px]">{description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="border-border-subtle bg-bg-raised/40 text-text-secondary inline-flex h-6 items-center gap-1 rounded-full border pr-1 pl-2 font-mono text-[11px]"
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-text-tertiary hover:text-text-primary flex size-4 cursor-pointer items-center justify-center rounded-full"
            >
              <X size={10} strokeWidth={2} />
            </button>
          </span>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex items-center gap-1"
        >
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            placeholder="hostname"
            aria-label={`Add to ${label.toLowerCase()}`}
            aria-invalid={error ? true : undefined}
            className={cn(
              'border-border-subtle bg-bg-ink text-text-primary placeholder:text-text-tertiary focus-visible:border-accent h-7 w-[180px] rounded-md border px-2 font-mono text-[12px] outline-none',
              error && 'border-danger'
            )}
          />
          <button
            type="submit"
            aria-label="Add"
            disabled={draft.trim() === ''}
            className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised flex size-7 cursor-pointer items-center justify-center rounded-md border disabled:opacity-40"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        </form>
      </div>
      {error && (
        <p role="alert" className="text-danger mt-1 text-[11px]">
          {error}
        </p>
      )}
    </div>
  );
}

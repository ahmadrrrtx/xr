/*
 * Skills Store primitives (Phase 20) — shared presentation atoms.
 * Visual vocabulary only; every decision comes from the engine record.
 */
import {
  AlertTriangle,
  BadgeCheck,
  Brain,
  Cpu,
  FileText,
  Globe,
  KeyRound,
  Mic,
  Monitor,
  MousePointer2,
  Pencil,
  Plug,
  Puzzle,
  ShieldAlert,
  Terminal,
  LayoutGrid,
  type LucideIcon,
} from 'lucide-react';

import {
  brandFor,
  permissionChip,
  QUARANTINE_COPY,
  TRUST_DETAIL,
  TRUST_LABEL,
  type PermissionChip,
  type SkillRecord,
  type TrustLevel,
  type WirePermission,
} from '@/skills/core';

const CATEGORY_COLOR: Record<string, string> = {
  developer: '#3B82F6',
  productivity: '#0EA5A4',
  business: '#7C5CFA',
  security: '#DC4A4A',
  research: '#2F8F6B',
  creative: '#D9677F',
  voice: '#C27A2B',
  ui: '#5B6BD8',
  data: '#2E7DA8',
  operations: '#4B7F3A',
  workflow: '#8A5CC2',
  memory: '#A0527A',
  mcp: '#4A6FA5',
  agent: '#4A86B8',
};

const CATEGORY_ICON: Record<string, LucideIcon> = {
  developer: Terminal,
  productivity: LayoutGrid,
  business: LayoutGrid,
  security: ShieldAlert,
  research: Brain,
  creative: Pencil,
  voice: Mic,
  ui: Monitor,
  data: Cpu,
  operations: Globe,
  workflow: Plug,
  memory: Brain,
  mcp: Plug,
  agent: Cpu,
};

const SCOPE_ICON: Record<string, LucideIcon> = {
  'fs:read': FileText,
  'fs:write': Pencil,
  net: Globe,
  browser: Monitor,
  'memory:read': Brain,
  'memory:write': Brain,
  provider: Cpu,
  voice: Mic,
  control: MousePointer2,
  secrets: KeyRound,
  ui: LayoutGrid,
  mcp: Plug,
  shell: Terminal,
};


/** Square icon: brand colour + monogram for known integrations, else category colour. */
export function SkillIcon({
  record,
  size = 'md',
}: {
  record: Pick<SkillRecord, 'id' | 'name' | 'tags' | 'categories'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const brand = brandFor(record);
  const cat = record.categories[0];
  const bg = brand?.color ?? CATEGORY_COLOR[cat] ?? '#4A86B8';
  const Fallback = CATEGORY_ICON[cat] ?? Puzzle;
  const sizeAttr = size === 'md' ? undefined : size;
  return (
    <span
      className="sk-icon"
      data-size={sizeAttr}
      style={{ background: bg }}
      aria-hidden="true"
      data-testid="skill-icon"
    >
      {brand ? brand.monogram : <Fallback size={size === 'lg' ? 28 : size === 'sm' ? 16 : 22} strokeWidth={1.5} />}
    </span>
  );
}

export function TrustBadge({ level, signed, keyId }: { level: TrustLevel; signed?: boolean; keyId?: string | null }) {
  const label = TRUST_LABEL[level];
  const Icon = level === 'unsigned' ? AlertTriangle : level === 'official' || level === 'verified' ? BadgeCheck : null;
  return (
    <span className="sk-trust" data-level={level} title={TRUST_DETAIL[level]}>
      {Icon ? <Icon size={12} strokeWidth={1.75} aria-hidden="true" /> : null}
      {label}
      {signed && keyId ? <span className="sk-keyid">· {keyId}</span> : null}
    </span>
  );
}

/** Verified check beside a publisher name (not a big endorsement seal). */
export function VerifiedCheck({ level }: { level: TrustLevel }) {
  if (level !== 'official' && level !== 'verified') return null;
  return (
    <BadgeCheck className="sk-verified" size={14} strokeWidth={1.75} aria-label={`${TRUST_LABEL[level]} publisher`} />
  );
}

export function PermissionChipList({
  permissions,
  max = 4,
  expanded = false,
}: {
  permissions: WirePermission[];
  max?: number;
  expanded?: boolean;
}) {
  if (permissions.length === 0) {
    return (
      <div className="sk-chips" aria-label="Permissions">
        <span className="sk-chip" data-muted="true">
          No permissions requested
        </span>
      </div>
    );
  }
  const chips = [...permissions]
    .map((p) => permissionChip(p))
    .sort((a, b) => Number(b.dangerous) - Number(a.dangerous));
  const shown = expanded ? chips : chips.slice(0, max);
  const hidden = chips.length - shown.length;
  return (
    <div className="sk-chips" aria-label={`Permissions: ${chips.map((c) => c.label).join(', ')}`}>
      {shown.map((c) => (
        <PermissionPill key={c.scope} chip={c} />
      ))}
      {hidden > 0 ? <span className="sk-chip-more">+{hidden} more</span> : null}
    </div>
  );
}

function PermissionPill({ chip }: { chip: PermissionChip }) {
  const Icon: LucideIcon = SCOPE_ICON[chip.scope] ?? Puzzle;
  return (
    <span className="sk-chip" data-danger={chip.dangerous ? 'true' : undefined} title={chip.consequence}>
      {chip.dangerous ? <AlertTriangle size={11} strokeWidth={2} aria-hidden="true" /> : <Icon size={11} strokeWidth={1.75} aria-hidden="true" />}
      {chip.dangerous ? `Warning: ${chip.label}` : chip.label}
    </span>
  );
}

/** Card-level "Review permissions" strip for dangerous grants. */
export function DangerStrip({ severity, text }: { severity: 'high' | 'medium'; text: string }) {
  return (
    <div className="sk-warn-strip" data-severity={severity} role="note">
      <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
      <span>
        <strong>Review permissions.</strong> {text}
      </span>
    </div>
  );
}

export function QuarantineBadge() {
  return (
    <span className="sk-state" data-state="quarantined" aria-label={QUARANTINE_COPY.badge} role="status">
      <ShieldAlert size={12} strokeWidth={1.75} aria-hidden="true" />
      Quarantined
    </span>
  );
}

/** Human-readable permission manifest row (modal + detail). */
export function PermissionRow({
  permission,
  granted,
  onToggle,
  controlLabel,
  disabled,
}: {
  permission: WirePermission;
  granted?: boolean;
  onToggle?: (next: boolean) => void;
  controlLabel?: string;
  disabled?: boolean;
}) {
  const chip: PermissionChip = permissionChip(permission);
  const Icon: LucideIcon = SCOPE_ICON[permission.scope] ?? Puzzle;
  const danger = chip.dangerous;
  const id = `perm-${permission.scope.replace(/[^a-z0-9]/gi, '-')}`;
  return (
    <div className="sk-perm" data-danger={danger ? 'true' : undefined} data-testid={`perm-${permission.scope}`}>
      <span className="sk-perm-icon" aria-hidden="true">
        {danger ? <AlertTriangle size={15} strokeWidth={1.75} /> : <Icon size={15} strokeWidth={1.75} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="sk-perm-title">
          <span>{chip.label}</span>
          <code style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{permission.scope}</code>
          {danger ? <span className="sk-perm-high">High risk</span> : null}
          {permission.optional ? <span className="sk-chip" data-muted="true">optional</span> : null}
        </div>
        <p className="sk-perm-why">
          {danger ? <>{chip.consequence} </> : null}
          {permission.reason}
        </p>
        {permission.domains.length ? <p className="sk-perm-why">Domains: {permission.domains.join(', ')}</p> : null}
        {permission.paths.length ? <p className="sk-perm-why">Paths: {permission.paths.join(', ')}</p> : null}
      </div>
      {onToggle ? (
        <label className="sk-perm-ctl" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={Boolean(granted)}
            disabled={disabled}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label={controlLabel ?? `Grant permission to ${chip.label.toLowerCase()}`}
          />
          {granted ? 'Granted' : 'Not granted'}
        </label>
      ) : (
        <span className="sk-perm-ctl">{granted ? 'Granted' : 'Not granted'}</span>
      )}
    </div>
  );
}

export function Stars({ average, count }: { average: number; count: number }) {
  if (!count) return <span>No ratings yet</span>;
  const full = Math.round(average);
  return (
    <span aria-label={`${average.toFixed(1)} out of 5 from ${count} ratings`}>
      <span className="sk-stars" aria-hidden="true">
        {'★'.repeat(full)}
        <span style={{ color: 'var(--text-tertiary)' }}>{'★'.repeat(Math.max(0, 5 - full))}</span>
      </span>{' '}
      {average.toFixed(1)} <span style={{ color: 'var(--text-tertiary)' }}>({count})</span>
    </span>
  );
}


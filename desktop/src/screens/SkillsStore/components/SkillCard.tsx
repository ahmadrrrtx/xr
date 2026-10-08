/*
 * Skill card (Phase 20) — one tile in the App-store grid.
 *
 * Layout: the whole card is a button-like target (click = detail, I = install,
 * arrows move focus between cards). Positioned children (state chip, footer)
 * sit above the target so their own clicks never open the detail.
 */
import { Download, RefreshCw, ShieldAlert } from 'lucide-react';
import { forwardRef } from 'react';

import {
  cardState,
  dangerSummary,
  formatCount,
  hasDangerousPermissions,
  trustOf,
  typeLabel,
  type SkillRecord,
} from '@/skills/core';

import { DangerStrip, PermissionChipList, SkillIcon, Stars, TrustBadge, VerifiedCheck } from './primitives';

export interface SkillCardProps {
  record: SkillRecord;
  index: number;
  focused: boolean;
  onOpen: (id: string) => void;
  onInstall: (id: string) => void;
  onUpdate: (id: string) => void;
  onToggle: (id: string) => void;
  onFocusCard: (id: string) => void;
}

export const SkillCard = forwardRef<HTMLButtonElement, SkillCardProps>(function SkillCard(
  { record, index, focused, onOpen, onInstall, onUpdate, onToggle, onFocusCard },
  ref,
) {
  const trust = trustOf(record);
  const state = cardState(record);
  const dangerous = hasDangerousPermissions(record);
  const trusted = trust === 'official' || trust === 'verified';
  const publisherLabel = record.publisher || 'unknown publisher';
  const bundled = record.source === 'bundled';

  const stateChip = (() => {
    switch (state) {
      case 'quarantined':
        return (
          <span className="sk-state" data-state="quarantined" role="status" aria-label={`${record.name}: quarantined, requires approval for each use`}>
            <ShieldAlert size={12} strokeWidth={1.75} aria-hidden="true" />
            Quarantined
          </span>
        );
      case 'update':
        return (
          <button type="button" className="sk-state" data-state="update" onClick={() => onUpdate(record.id)} aria-label={`Update ${record.name} to ${record.version}`}>
            <RefreshCw size={11} strokeWidth={1.75} aria-hidden="true" /> Update
          </button>
        );
      case 'disabled':
        return (
          <button type="button" className="sk-state" data-state="disabled" onClick={() => onToggle(record.id)} aria-label={`${record.name} is disabled. Enable it`}>
            Disabled
          </button>
        );
      case 'installed':
        return (
          <button type="button" className="sk-state" data-state="installed" onClick={() => onToggle(record.id)} aria-label={`${record.name} is installed and enabled. Disable it`}>
            ✓ Installed
          </button>
        );
      default:
        return (
          <button type="button" className="sk-state" data-state="install" onClick={() => onInstall(record.id)} aria-label={`Install ${record.name}`} data-testid="card-install">
            <Download size={11} strokeWidth={1.75} aria-hidden="true" /> Install
          </button>
        );
    }
  })();

  const danger = dangerous ? dangerSummary(record) : '';
  const severity = /shell|control|computer/i.test(danger) ? 'high' : 'medium';

  return (
    <article
      className="sk-card"
      style={{ ['--i' as string]: index }}
      data-testid={`skill-card-${record.id}`}
      data-state={state}
      data-focus={focused ? 'true' : undefined}
      aria-label={`${record.name}, ${typeLabel(record.skillType)}, ${publisherLabel}`}
      onFocus={() => onFocusCard(record.id)}
    >
      <button
        ref={ref}
        type="button"
        className="sk-card-open"
        onClick={() => onOpen(record.id)}
        aria-label={`Open ${record.name} details`}
        data-skill-id={record.id}
        data-testid={`skill-open-${record.id}`}
      />
      <div className="sk-card-top">
        <SkillIcon record={record} />
        {stateChip}
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h3 className="sk-card-name" title={record.name}>
          {record.name}
        </h3>
        <div className="sk-publisher">
          <span className="sk-publisher-name">{publisherLabel}</span>
          <VerifiedCheck level={trust} />
          {!trusted ? <span style={{ color: 'var(--text-tertiary)' }}>({trust === 'unsigned' ? 'unsigned' : trust})</span> : null}
        </div>
      </div>
      <p className="sk-card-desc">{record.description}</p>
      <PermissionChipList permissions={record.permissions} max={3} />
      {dangerous ? <DangerStrip severity={severity} text={danger} /> : null}
      <div className="sk-card-foot">
        <div className="sk-meta">
          <span>{bundled ? 'bundled' : `${formatCount(record.downloads)} installs`}</span>
          <span aria-hidden="true">·</span>
          <Stars average={record.rating.average} count={record.rating.count} />
          <span aria-hidden="true">·</span>
          <span>{typeLabel(record.skillType)}</span>
        </div>
        {trust === 'unsigned' ? <TrustBadge level={trust} /> : null}
      </div>
    </article>
  );
});

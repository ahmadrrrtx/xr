/*
 * Featured hero (Phase 20) — 80px banner, shown on the Featured category.
 * The registry's `featured` flag wins; offline it falls back to the first
 * official bundled skill and says so ("Featured from bundled catalog").
 */
import { Download, ShieldCheck } from 'lucide-react';

import { cardState, trustOf, type SkillRecord } from '@/skills/core';

import { SkillIcon, TrustBadge } from './primitives';

export function FeaturedBanner({
  record,
  fromRegistry,
  onOpen,
  onInstall,
}: {
  record: SkillRecord;
  fromRegistry: boolean;
  onOpen: (id: string) => void;
  onInstall: (id: string) => void;
}) {
  const state = cardState(record);
  const trust = trustOf(record);
  return (
    <section className="sk-hero" aria-label="Featured skill" data-testid="featured-hero">
      <SkillIcon record={record} size="lg" />
      <div className="sk-hero-body">
        <div className="sk-hero-name">
          <button
            type="button"
            onClick={() => onOpen(record.id)}
            style={{ all: 'unset', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
          >
            {record.name}
          </button>
          <TrustBadge level={trust} />
        </div>
        <p className="sk-hero-tag">
          {record.description.length > 110 ? `${record.description.slice(0, 107)}…` : record.description}
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {fromRegistry ? 'Featured by the XR registry.' : 'Featured from the bundled catalog (offline).'}
          </span>
        </p>
      </div>
      {state === 'install' ? (
        <button type="button" className="sk-btn sk-btn--primary" onClick={() => onInstall(record.id)} data-testid="hero-install">
          <Download size={14} strokeWidth={1.75} aria-hidden="true" />
          Install
        </button>
      ) : (
        <span className="sk-chip" style={{ height: 30 }}>
          <ShieldCheck size={12} strokeWidth={1.75} aria-hidden="true" />
          {state === 'installed' ? 'Installed' : state === 'quarantined' ? 'Quarantined' : 'Installed'}
        </span>
      )}
    </section>
  );
}

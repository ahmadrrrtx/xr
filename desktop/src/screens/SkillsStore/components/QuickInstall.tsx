/*
 * ⌘K quick install (Phase 20 §16) — search skills and install without leaving
 * the screen. Arrow keys move, Enter opens the same install dialog as a card.
 */
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useSkillsStore } from '@/stores/skillsStore';
import { cardState, matchesQuery, type SkillRecord } from '@/skills/core';

import { SkillIcon } from './primitives';

const SR_ONLY: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' };

export function QuickInstall({ records }: { records: SkillRecord[] }) {
  const open = useSkillsStore((s) => s.quickInstallOpen);
  const setOpen = useSkillsStore((s) => s.setQuickInstallOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sk-dialog" data-size="narrow" showCloseButton={false} aria-describedby="qi-desc" data-testid="quick-install">
        <Palette records={records} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted fresh each time the dialog opens, so the query and selection reset. */
function Palette({ records }: { records: SkillRecord[] }) {
  const setOpen = useSkillsStore((s) => s.setQuickInstallOpen);
  const openInstall = useSkillsStore((s) => s.openInstall);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const rows = useMemo(() => {
    const pool = records.filter((r) => cardState(r) === 'install' || cardState(r) === 'update');
    return (q.trim() ? pool.filter((r) => matchesQuery(r, q)) : pool).slice(0, 12);
  }, [records, q]);

  const pick = (r: SkillRecord | undefined) => {
    if (!r) return;
    setOpen(false);
    openInstall(r.id, cardState(r) === 'update' ? 'update' : 'install');
  };

  return (
    <>
      <DialogTitle style={SR_ONLY}>Quick install</DialogTitle>
      <DialogDescription id="qi-desc" style={SR_ONLY}>
        Search for a skill and press Enter to review its permissions before installing.
      </DialogDescription>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={16} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--text-tertiary)' }} />
        <input
          ref={inputRef}
          className="sk-input"
          style={{ border: 0, background: 'transparent', height: 32 }}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); pick(rows[active]); }
          }}
          placeholder="Quick install — type a skill name…"
          role="combobox"
          aria-expanded="true"
          aria-controls="qi-list"
          aria-activedescendant={rows[active] ? `qi-${rows[active].id}` : undefined}
          aria-label="Search skills to install"
        />
        <kbd style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Esc</kbd>
      </div>
      <div id="qi-list" role="listbox" aria-label="Skills available to install" style={{ padding: 6, maxHeight: 360, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <p className="sk-sub" style={{ padding: 12 }}>
            {q.trim() ? `No uninstalled skills match “${q.trim()}”.` : 'Everything in the catalog is installed.'}
          </p>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              id={`qi-${r.id}`}
              role="option"
              aria-selected={i === active}
              className="sk-palette-row"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r)}
            >
              <SkillIcon record={r} size="sm" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div className="sk-hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</div>
              </div>
              <span className="sk-hint">{cardState(r) === 'update' ? 'Update' : 'Install'}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

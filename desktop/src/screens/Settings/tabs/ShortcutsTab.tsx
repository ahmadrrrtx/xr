/*
 * Settings → Shortcuts (Phase 8) — every chord XR registers, in one place.
 * In-app rows persist through settingsStore overrides; global rows rebind
 * the Rust-owned registrations at runtime and show what the OS currently
 * holds. Conflicts are detected live while recording.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { Globe, RotateCcw } from 'lucide-react';
import { isTauri } from '@/lib/tauri';
import {
  eventToCombo,
  findConflicts,
  formatChord,
  formatTauriChord,
  SHORTCUTS,
  toTauriChord,
  type GlobalOwner,
} from '@/lib/shortcuts';
import {
  hudSetShortcut,
  hudShortcutInfo,
  orbSetShortcut,
  orbShortcutInfo,
  pttSetShortcut,
  pttShortcutInfo,
  theaterSetShortcut,
  theaterShortcutInfo,
} from '@/lib/settingsApi';
import { useSettingsStore } from '@/stores/settingsStore';

const SETTERS: Record<GlobalOwner, (chord: string) => Promise<{ shortcut: string; conflict: boolean } | null>> = {
  hud: hudSetShortcut,
  orb: orbSetShortcut,
  ptt: pttSetShortcut,
  theater: theaterSetShortcut,
};

const INFOS: Record<GlobalOwner, () => Promise<string | null>> = {
  hud: hudShortcutInfo,
  orb: orbShortcutInfo,
  ptt: pttShortcutInfo,
  theater: theaterShortcutInfo,
};

type Warning = { kind: 'modifier' | 'conflict' | 'system' } | null;

export function ShortcutsTab() {
  const overrides = useSettingsStore((state) => state.settings.shortcuts.overrides);
  const update = useSettingsStore((state) => state.update);

  const [query, setQuery] = useState('');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [warning, setWarning] = useState<Warning>(null);
  const [registered, setRegistered] = useState<Partial<Record<GlobalOwner, string>>>({});

  // what the OS currently holds for the three global chords
  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      const entries = await Promise.all(
        (['hud', 'orb', 'ptt', 'theater'] as GlobalOwner[]).map(async (owner) => {
          const chord = await INFOS[owner]();
          return [owner, chord] as const;
        })
      );
      setRegistered(Object.fromEntries(entries.filter(([, chord]) => chord !== null)));
    })();
  }, []);

  const stop = (): void => {
    setRecordingId(null);
    setWarning(null);
  };

  const applyCombo = (id: string, combo: string): void => {
    const shortcut = SHORTCUTS.find((definition) => definition.id === id);
    if (!shortcut) return;
    const conflicts = findConflicts(combo, id, overrides);
    if (conflicts.length > 0) {
      setWarning({ kind: 'conflict' });
    }
    if (shortcut.scope === 'global' && shortcut.global) {
      const owner = shortcut.global;
      void SETTERS[owner](toTauriChord(combo)).then((result) => {
        if (result === null) {
          if (isTauri()) {
            setWarning({ kind: 'system' });
            return;
          }
          // browser preview — persist for display only
        } else if (result.conflict) {
          setWarning({ kind: 'system' });
          return;
        } else {
          setRegistered((current) => ({ ...current, [owner]: result.shortcut }));
          toast.success(`${shortcut.label}: ${formatChord(combo)}`);
        }
        update('shortcuts', { overrides: { ...overrides, [id]: combo } });
        if (conflicts.length === 0) stop();
      });
      return;
    }
    update('shortcuts', { overrides: { ...overrides, [id]: combo } });
    if (conflicts.length === 0) {
      toast.success(`${shortcut.label}: ${formatChord(combo)}`);
      stop();
    }
  };

  // capture-phase recorder: steals keys before any other handler
  useEffect(() => {
    if (!recordingId) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        stop();
        return;
      }
      const combo = eventToCombo(event);
      if (!combo) return;
      if (!combo.includes('+')) {
        setWarning({ kind: 'modifier' });
        return;
      }
      applyCombo(recordingId, combo);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, overrides]);

  const resetAll = (): void => {
    update('shortcuts', { overrides: {} });
    if (isTauri()) {
      void (async () => {
        const defaults = SHORTCUTS.filter(
          (shortcut) => shortcut.scope === 'global' && shortcut.global
        );
        for (const shortcut of defaults) {
          const owner = shortcut.global!;
          const result = await SETTERS[owner](toTauriChord(shortcut.combo));
          if (result) setRegistered((current) => ({ ...current, [owner]: result.shortcut }));
        }
      })();
    }
    setRegistered({});
    stop();
    toast.success('Shortcuts reset to defaults');
  };

  const effective = (id: string): string => {
    const shortcut = SHORTCUTS.find((definition) => definition.id === id);
    return overrides[id] ?? shortcut?.combo ?? '';
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return SHORTCUTS;
    return SHORTCUTS.filter(
      (shortcut) =>
        shortcut.label.toLowerCase().includes(needle) ||
        formatChord(effective(shortcut.id)).toLowerCase().includes(needle)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effective derives from overrides
  }, [query, overrides]);

  const globals = filtered.filter((shortcut) => shortcut.scope === 'global');
  const inApp = filtered.filter((shortcut) => shortcut.scope !== 'global');

  const renderRow = (id: string, label: string, scope: 'app' | 'chat' | 'global'): ReactNode => {
    const shortcut = SHORTCUTS.find((definition) => definition.id === id)!;
    const recording = recordingId === id;
    const conflicts =
      warning?.kind === 'conflict' && recording ? findConflicts(effective(id), id, overrides) : [];
    return (
      <SettingRow
        key={id}
        label={
          <span className="flex items-center gap-2">
            {scope === 'global' ? (
              <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                <Globe size={9} className="mr-1" /> Global
              </Badge>
            ) : null}
            <span className="text-text-primary text-[13px] font-medium">{label}</span>
          </span>
        }
        description={
          recording
            ? warning?.kind === 'modifier'
              ? 'Add a modifier (⌘/Ctrl, Alt or Shift). Esc cancels.'
              : warning?.kind === 'conflict'
                ? `Already used by ${conflicts.map((hit) => hit.label).join(', ')} — pick another chord.`
                : warning?.kind === 'system'
                  ? 'The OS refused that chord — another app may own it. Try again.'
                  : 'Press keys now. Esc cancels.'
            : scope === 'global'
              ? 'Works even when XR is not focused.'
              : undefined
        }
      >
        {recording ? (
          <div className="flex items-center gap-2">
            <span className="border-accent/60 text-accent animate-pulse rounded-md border border-dashed px-2.5 py-1 text-xs">
              Recording…
            </span>
            <Button variant="ghost" size="sm" onClick={stop}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {scope === 'global' ? (
              <Kbd>{formatTauriChord(registered[shortcut.global as GlobalOwner] ?? toTauriChord(effective(id)))}</Kbd>
            ) : (
              <Kbd>{formatChord(effective(id))}</Kbd>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setWarning(null);
                setRecordingId(id);
              }}
            >
              Rebind
            </Button>
          </div>
        )}
      </SettingRow>
    );
  };

  return (
    <div>
      {/* ── Search ── */}
      <div className="mb-5">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search shortcuts…"
          aria-label="Search shortcuts"
          className="border-border-subtle bg-bg-raised text-text-primary placeholder:text-text-quaternary focus-visible:border-accent h-8 w-full max-w-xs rounded-md border px-3 text-xs outline-none"
        />
      </div>

      {/* ── Global ── */}
      {globals.length > 0 ? (
        <SettingsSection title="Global (works anywhere)">
          {globals.map((shortcut) => renderRow(shortcut.id, shortcut.label, 'global'))}
        </SettingsSection>
      ) : null}

      {/* ── In-app ── */}
      <SettingsSection title="In-app">
        {inApp.length > 0 ? (
          inApp.map((shortcut) => renderRow(shortcut.id, shortcut.label, shortcut.scope))
        ) : (
          <p className="text-text-tertiary px-3.5 py-4 text-xs">No shortcuts match “{query}”.</p>
        )}
      </SettingsSection>

      {/* ── Reset ── */}
      <SettingsSection title="Reset">
        <SettingRow
          label="Restore all defaults"
          description="Clears your overrides and rebinds the global chords."
        >
          <Button variant="ghost" size="sm" onClick={resetAll}>
            <RotateCcw size={13} strokeWidth={1.5} /> Reset
          </Button>
        </SettingRow>
      </SettingsSection>
    </div>
  );
}

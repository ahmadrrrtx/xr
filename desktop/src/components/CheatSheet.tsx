/**
 * XR — keyboard cheat-sheet (Phase 1 · audit D-08).
 *
 * The audit measured: pressing `?` produced NO UI at all (`after '?': NONE
 * FOUND`). There was no discoverable list of shortcuts anywhere in the shell.
 *
 * This renders from the SAME command registry the palette uses, so a command
 * cannot be reachable by keyboard yet missing from this sheet. Searchable, and
 * itself dismissible with Esc / ? / click-outside.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { groupCommands, rankCommands, type Command } from "../commands/registry";

export function CheatSheet({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      // Focus the filter so a power user can type immediately.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Esc closes; `?` toggles closed as well (it opened us).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "?" && document.activeElement !== inputRef.current)) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const withShortcut = useMemo(() => commands.filter((c) => c.shortcut), [commands]);
  const grouped = useMemo(
    () => groupCommands(q.trim() ? rankCommands(commands, q, 200) : withShortcut),
    [commands, q, withShortcut],
  );

  if (!open) return null;

  return (
    <div className="pal-veil" onClick={onClose} role="presentation">
      <div
        className="pal cheat"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cheat-h">
          <b>Keyboard shortcuts</b>
          <span className="faint"> — generated from the live command registry</span>
        </div>
        <input
          ref={inputRef}
          className="pal-input"
          placeholder="Filter commands…"
          value={q}
          aria-label="Filter commands"
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="cheat-body">
          {grouped.length === 0 && (
            <div className="pal-empty faint">no commands match “{q}”</div>
          )}
          {grouped.map(({ group, items }) => (
            <section key={group} className="cheat-group">
              <div className="pal-h">{group}</div>
              {items.map((c) => (
                <div key={c.id} className="cheat-row">
                  <span className="cheat-label">{c.label}</span>
                  {c.hint && <span className="cheat-hint faint">{c.hint}</span>}
                  <kbd className="cheat-kbd mono">{c.shortcut ?? "—"}</kbd>
                </div>
              ))}
            </section>
          ))}
          <section className="cheat-group">
            <div className="pal-h">Global</div>
            {GLOBAL_SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="cheat-row">
                <span className="cheat-label">{label}</span>
                <kbd className="cheat-kbd mono">{keys}</kbd>
              </div>
            ))}
          </section>
        </div>
        <div className="cheat-foot faint">
          <kbd className="cheat-kbd mono">?</kbd> or <kbd className="cheat-kbd mono">Esc</kbd> to close
          <span className="cheat-foot-note">
            Commands without a binding are still reachable from <kbd className="cheat-kbd mono">⌘K</kbd>.
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Bindings implemented in the shell. Listed here (not in the registry) because
 * they are handled by window-level listeners rather than commands — and the
 * sheet must not claim a binding that does not exist.
 */
const GLOBAL_SHORTCUTS: Array<[string, string]> = [
  ["⌘K / Ctrl+K", "Open the command palette"],
  ["?", "This cheat-sheet"],
  ["Esc", "Close palette / sheet · exit Voice mode"],
  ["Space", "In Voice: start or stop listening (push-to-talk)"],
];

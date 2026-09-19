/**
 * XR — Command Palette (⌘K / Ctrl+K).
 *
 * Phase 1 · D-08: rewritten over the shared command REGISTRY
 * (`../commands/registry`) instead of an inline nav list, so the palette, the
 * `?` cheat-sheet and any future context menu read from one source.
 *
 * Before this change, `mcp` and `ollama` returned ZERO results here; the
 * registry now carries synonyms for every destination and every engine
 * capability, and dynamic sources (skills, live runs) are merged from real
 * engine reads.
 *
 * Everything executed is a real navigation, a real engine call, or a real local
 * preference write. Nothing simulated.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, asList, type SessionSummary } from "../api/client";
import type { Area } from "./AppShell";
import {
  buildCommands,
  groupCommands,
  rankCommands,
  type Command,
  type RegistryDeps,
} from "../commands/registry";

export interface PaletteProps {
  open: boolean;
  onClose: () => void;
  onArea: (a: Area) => void;
  onNewTask: () => void;
  onVoice: () => void;
  onOnboard: () => void;
  onRunSkill: (id: string, name: string) => void;
  onVoiceSession: () => void;
  onTheme: (t: "dark" | "light" | "system") => void;
  onDensity: (d: "compact" | "comfortable" | "spacious") => void;
  onToggleNotifications: () => Promise<boolean> | boolean;
  notificationsEnabled: () => boolean;
  onCheatSheet: () => void;
  onRefresh?: () => void;
}

export function Palette(props: PaletteProps) {
  const { open, onClose } = props;
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [registry, setRegistry] = useState<Command[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const deps = useMemo<RegistryDeps>(
    () => ({
      onArea: props.onArea,
      onNewTask: props.onNewTask,
      onVoiceSession: props.onVoiceSession,
      onOnboard: props.onOnboard,
      onRunSkill: props.onRunSkill,
      onTheme: props.onTheme,
      onDensity: props.onDensity,
      onToggleNotifications: props.onToggleNotifications,
      notificationsEnabled: props.notificationsEnabled,
      onCheatSheet: props.onCheatSheet,
      onRefresh: props.onRefresh,
    }),
    [
      props.onArea, props.onNewTask, props.onVoiceSession, props.onOnboard,
      props.onRunSkill, props.onTheme, props.onDensity, props.onToggleNotifications,
      props.notificationsEnabled, props.onCheatSheet, props.onRefresh,
    ],
  );

  /* Open/close: focus the input, remember the invoker, restore focus on close.
     Audit a11y: Esc must return focus to whatever opened the palette. */
  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      restoreRef.current?.focus?.();
    }
  }, [open]);

  /* Build the static registry immediately; merge engine sources when open. */
  useEffect(() => {
    if (open) void buildCommands(deps).then(setRegistry);
  }, [open, deps]);

  /* Live engine search — debounced, best-effort. An unreachable engine yields
     fewer results, never fabricated ones. */
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      if (open) void buildCommands(deps).then(setRegistry);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      Promise.allSettled([api.skills(term), api.sessions()]).then(([s, r]) => {
        if (!live) return;
        const sk = s.status === "fulfilled" ? (s.value.skills ?? []) : [];
        const all = r.status === "fulfilled" ? asList<SessionSummary>(r.value, "sessions") : [];
        const low = term.toLowerCase();
        const rs = all
          .filter((x) => `${x.title ?? ""} ${x.prompt ?? ""}`.toLowerCase().includes(low))
          .slice(0, 4);
        // Engine hits are folded into the registry, not stored separately —
        // one list, one ordering, one source of truth for what Enter runs.
        void buildCommands(deps, { skills: sk.slice(0, 6), runs: rs }).then(setRegistry);
      });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, open, deps]);

  const commands = useMemo(() => rankCommands(registry, q, 60), [registry, q]);
  const grouped = useMemo(() => groupCommands(commands), [commands]);

  /** Flat order MUST match the rendered order so Enter runs what is highlighted. */
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  /* Focus trap — audit: the palette must not let the background take events. */
  /**
   * Escape is bound at the WINDOW, not only on the dialog.
   *
   * Focus lands in the input via a `setTimeout(…, 0)` — a real user can press
   * Escape in that gap (and the renderer lane did exactly that), in which case
   * the keydown never passes through the dialog and nothing closes. A dialog
   * that can only be dismissed once focus has settled is a trap waiting for
   * slow hardware.
   */
  useEffect(() => {
    if (!open) return;
    const onWinKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onWinKey, true);
    return () => window.removeEventListener("keydown", onWinKey, true);
  }, [open, onClose]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, flat.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === "Home") { e.preventDefault(); setIdx(0); }
      if (e.key === "End") { e.preventDefault(); setIdx(Math.max(0, flat.length - 1)); }
      if (e.key === "Enter" && flat[idx]) {
        e.preventDefault();
        const chosen = flat[idx];
        onClose();
        void chosen.run();
      }
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Tab") {
        // Keep focus inside the dialog.
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])',
        );
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    },
    [flat, idx, onClose],
  );

  if (!open) return null;

  const exec = (c: Command) => { onClose(); void c.run(); };
  let n = -1;

  return (
    <div className="pal-veil" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="pal"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="pal-input"
          placeholder="Type a command — actions, nav, skills, runs, models, MCP…"
          value={q}
          aria-label="Command palette input"
          aria-activedescendant={flat[idx] ? `pal-opt-${flat[idx].id}` : undefined}
          role="combobox"
          aria-expanded="true"
          aria-controls="pal-listbox"
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
        />
        <div className="pal-list" role="listbox" id="pal-listbox" aria-label="Commands">
          {flat.length === 0 && (
            <div className="pal-empty faint">
              no matches — actions, navigation, skills, runs and settings are searched live
            </div>
          )}
          {grouped.map(({ group, items }) => (
            <div key={group}>
              <div className="pal-h">{group}</div>
              {items.map((c) => {
                n += 1;
                const active = n === idx;
                return (
                  <button
                    key={c.id}
                    id={`pal-opt-${c.id}`}
                    className={active ? "pal-item on" : "pal-item"}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setIdx(flat.indexOf(c))}
                    onClick={() => exec(c)}
                  >
                    <span className="pal-label">{c.label}</span>
                    {c.hint && <span className="pal-hint faint">{c.hint}</span>}
                    {c.shortcut && <kbd className="pal-kbd mono">{c.shortcut}</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="pal-foot faint">
          <span>↑↓ navigate · ↵ run · esc close</span>
          <span className="pal-foot-r">
            <kbd className="pal-kbd mono">?</kbd> all shortcuts
          </span>
        </div>
      </div>
    </div>
  );
}

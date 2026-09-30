/*
 * Global keyboard shortcuts — tiny, dependency-free hotkey hook.
 *
 * Combos are declared as strings: "mod+k", "mod+shift+t", "mod+,", "escape".
 * "mod" matches Cmd on macOS and Ctrl elsewhere (either is accepted so the
 * same handler works in the browser preview on any OS). Matched events are
 * `preventDefault`-ed so the webview/browser never applies its own binding
 * (e.g. Cmd+K focusing the location bar).
 */
import { useEffect, useRef } from 'react';

export interface Hotkey {
  /** e.g. "mod+k", "mod+shift+t", "escape" */
  combo: string;
  handler: (event: KeyboardEvent) => void;
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  const modifiers = parts.slice(0, -1);

  const wantMod = modifiers.includes('mod');
  const wantShift = modifiers.includes('shift');
  const wantAlt = modifiers.includes('alt');

  const hasMod = event.metaKey || event.ctrlKey;
  const hasShift = event.shiftKey;
  const hasAlt = event.altKey;

  if (wantMod !== hasMod) return false;
  if (wantShift !== hasShift) return false;
  if (wantAlt !== hasAlt) return false;

  // Shift changes the produced glyph ("T" vs "t", "?" vs ".") — compare on
  // the unmodified key so "mod+shift+t" matches Cmd+Shift+T everywhere.
  const eventKey =
    event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();

  if (eventKey === key) return true;
  // "escape" vs "esc", arrow aliases:
  if (key === 'escape' && eventKey === 'esc') return true;
  return false;
}

/**
 * Bind a list of hotkeys for the lifetime of the calling component.
 * Handlers are kept in a ref so the listener never needs re-binding.
 */
export function useHotkeys(hotkeys: readonly Hotkey[]): void {
  const ref = useRef(hotkeys);

  // Keep the ref current without touching it during render.
  useEffect(() => {
    ref.current = hotkeys;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      for (const hotkey of ref.current) {
        if (matches(event, hotkey.combo)) {
          event.preventDefault();
          event.stopPropagation();
          hotkey.handler(event);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

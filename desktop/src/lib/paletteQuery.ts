/*
 * Palette query primitives (Phase 5) — deliberately dependency-free.
 *
 * The command REGISTRY (paletteCommands.tsx) imports stores and icons, so it
 * cannot be loaded by the root test tier (no `@/` alias there). Everything
 * algorithmic about palette queries lives HERE instead, where the unit tier
 * can import it by path and prove it.
 */

export type PaletteGroup = 'commands' | 'chats' | 'agents' | 'workspaces' | 'settings';

export type PrefixMode = 'all' | 'commands' | 'agents' | 'search' | 'dev';

/** Minimum characters before a query is offerable to quick-ask. */
export const QUICK_ASK_MIN_CHARS = 3;

/** Parse the leading prefix filter off a raw palette query. */
export function parsePaletteQuery(raw: string): { mode: PrefixMode; rest: string } {
  if (raw.startsWith('/')) return { mode: 'commands', rest: raw.slice(1) };
  if (raw.startsWith('@')) return { mode: 'agents', rest: raw.slice(1) };
  if (raw.startsWith('?')) return { mode: 'search', rest: raw.slice(1) };
  if (raw.startsWith('>')) return { mode: 'dev', rest: raw.slice(1) };
  return { mode: 'all', rest: raw };
}

/**
 * cmdk custom filter — the prefix has to be invisible to scoring, which the
 * built-in filter cannot do. Scoring is a conservative fuzzy subsequence:
 *   1.0  substring hit (title/keyword)
 *   0.x  full-char subsequence, boosted for consecutive runs
 *   0    filtered out (AND semantics — every query char must appear in order)
 */
export function paletteFilter(
  value: string,
  search: string,
  keywords?: string[]
): number {
  const { rest } = parsePaletteQuery(search);
  const q = rest.trim().toLowerCase();
  const v = (keywords ? `${value} ${keywords.join(' ')}` : value).toLowerCase();
  if (q.length === 0) return 1;
  if (v.includes(q)) return 1;

  let vi = 0;
  let streak = 0;
  let best = 0;
  for (const ch of q) {
    const idx = v.indexOf(ch, vi);
    if (idx === -1) return 0;
    streak = idx === vi ? streak + 1 : 1;
    best = Math.max(best, streak);
    vi = idx + 1;
  }
  return 0.4 + 0.3 * (best / q.length) + 0.3 * (q.length / v.length);
}

/** Groups shown for a prefix mode (false = the registry is hidden entirely). */
export function groupAllowed(mode: PrefixMode, group: PaletteGroup, dev: boolean): boolean {
  switch (mode) {
    case 'commands':
      return group === 'commands';
    case 'agents':
      return group === 'agents';
    case 'dev':
      return dev; // '>' shows ONLY dev commands
    case 'search':
      return false; // '?' replaces the registry with the web-search stub
    default:
      return true;
  }
}

/** "2h ago" / "3d ago" — palette subtitles for recent sessions. */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString();
}

/** Platform-correct modifier for shortcut hints. */
export function modLabel(platform: string): string {
  return platform === 'macos' ? '⌘' : 'Ctrl+';
}

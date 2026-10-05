/*
 * Phase 10 — template strip definitions (brief §3, SCREEN 3).
 *
 * Offline by design: web/python/research/custom are scaffolded by the Rust
 * side as hand-written files (no npm/bun install — the web README tells the
 * user to run `bun install`). `git` clones via the system git CLI; `scratch`
 * is a quick blank folder.
 */
import type { WorkspaceKind } from './types';

export interface WorkspaceTemplate {
  id: string;
  kind: WorkspaceKind;
  label: string;
  /** Emoji shown on the strip card (user-facing, per brief). */
  emoji: string;
  blurb: string;
  /** true → strip card expands to an inline URL input (git clone). */
  needsUrl?: boolean;
}

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'web',
    kind: 'web',
    label: 'Web app',
    emoji: '\u{1F310}',
    blurb: 'Vite + React + TS — bun install to go',
  },
  {
    id: 'python',
    kind: 'python',
    label: 'Python',
    emoji: '\u{1F40D}',
    blurb: 'main.py + requirements.txt',
  },
  {
    id: 'research',
    kind: 'research',
    label: 'Research',
    emoji: '\u{1F52C}',
    blurb: 'sources/ · notes/ · outline.md',
  },
  {
    id: 'custom',
    kind: 'custom',
    label: 'Blank',
    emoji: '\u{2728}',
    blurb: 'Just a folder and a README',
  },
  {
    id: 'git',
    kind: 'git',
    label: 'Git clone',
    emoji: '\u{1F4C1}',
    blurb: 'Clone any repo with live progress',
    needsUrl: true,
  },
  {
    id: 'scratch',
    kind: 'scratch',
    label: 'Scratch',
    emoji: '\u{1F4C4}',
    blurb: 'Quick throwaway space',
  },
];

/*
 * Phase 10 — Workspace types (docs/SCREEN-BRIEFS.md · SCREEN 3).
 *
 * Mirrors the Rust wire model in src-tauri/src/commands/workspaces/model.rs
 * (serde camelCase). `pathExists` is computed at read time on the Rust side.
 */
import {
  Braces,
  Folder,
  FlaskConical,
  GitBranch,
  Globe,
  LayoutGrid,
  Microscope,
  type LucideIcon,
} from 'lucide-react';

export type WorkspaceKind =
  'web' | 'python' | 'research' | 'custom' | 'git' | 'scratch';

export interface WindowBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  path: string;
  kind: WorkspaceKind;
  icon: string | null;
  stack: string[];
  pinned: boolean;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
  windowBounds: WindowBounds | null;
  pathExists: boolean;
}

/** Partial update — mirrors Rust WorkspacePatch. */
export interface WorkspacePatch {
  name?: string;
  path?: string;
  icon?: string;
  stack?: string[];
  pinned?: boolean;
  lastOpenedAt?: number;
  windowBounds?: WindowBounds | null;
}

export interface SpawnResult {
  opened: number;
  failed: number;
}

export interface CloneProgress {
  percent: number;
  stage: string;
}

// ── Display metadata per kind (gradients live in themes.css) ───────────────

export const WORKSPACE_KIND_META: Record<
  WorkspaceKind,
  {
    label: string;
    icon: LucideIcon;
    /** CSS variable prefix for the gradient pair, e.g. `--ws-web-from`. */
    gradientVar: 'web' | 'python' | 'research' | 'custom' | 'git' | 'scratch';
    /** Short, honest one-liner used in the template strip. */
    blurb: string;
  }
> = {
  web: {
    label: 'Web app',
    icon: Globe,
    gradientVar: 'web',
    blurb: 'Vite + React + TypeScript',
  },
  python: {
    label: 'Python',
    icon: FlaskConical,
    gradientVar: 'python',
    blurb: 'Script or service starter',
  },
  research: {
    label: 'Research',
    icon: Microscope,
    gradientVar: 'research',
    blurb: 'Sources, notes, outline',
  },
  custom: {
    label: 'Blank',
    icon: Braces,
    gradientVar: 'custom',
    blurb: 'A folder and a README',
  },
  git: {
    label: 'Git clone',
    icon: GitBranch,
    gradientVar: 'git',
    blurb: 'Clone any repository',
  },
  scratch: {
    label: 'Scratch',
    icon: Folder,
    gradientVar: 'scratch',
    blurb: 'Throwaway space, quick',
  },
};

/** Icon used on a card: user emoji when set, otherwise the kind icon. */
export function workspaceIcon(ws: Pick<Workspace, 'icon' | 'kind'>): {
  emoji: string | null;
  Icon: LucideIcon;
} {
  return {
    emoji: ws.icon && ws.icon.length > 0 ? ws.icon : null,
    Icon: WORKSPACE_KIND_META[ws.kind].icon,
  };
}

/** Stack chip tone — stable classes (no dynamic Tailwind strings). */
export const STACK_TONES: Record<string, string> = {
  web: 'stack-web',
  vite: 'stack-web',
  ts: 'stack-web',
  react: 'stack-web',
  python: 'stack-python',
  rust: 'stack-git',
  go: 'stack-git',
  research: 'stack-research',
  git: 'stack-git',
};

export function stackTone(token: string): string {
  return STACK_TONES[token] ?? 'stack-custom';
}

/** Grid/layout icon for the screen (sidebar + header). */
export const WorkspacesIcon: LucideIcon = LayoutGrid;

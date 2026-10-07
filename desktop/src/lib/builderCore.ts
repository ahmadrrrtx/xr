/*
 * Builder core (Phase 17) — PURE. No React, no stores, no DOM, no desktop
 * node_modules: this module is unit-tested from the repo root
 * (`test/desktop/builder-core.test.ts`) with relative imports only.
 *
 * Everything the Builder screen reasons about without rendering: language
 * detection, file icons, fuzzy matching for Quick Open, tab MRU order,
 * pane geometry, unified-diff extraction from chat markdown, `file:line`
 * links, console-line classification, the context the model is given and
 * the system rule that makes it answer with diffs instead of whole files.
 */

/* ── Languages ─────────────────────────────────────────────────────────── */

export type LanguageId =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'json'
  | 'css'
  | 'html'
  | 'markdown'
  | 'python'
  | 'rust'
  | 'yaml'
  | 'toml'
  | 'shell'
  | 'plain';

export interface LanguageInfo {
  id: LanguageId;
  label: string;
  /** Default indent for the status bar when the file gives no hint. */
  indent: number;
}

const BY_EXT: Record<string, LanguageInfo> = {
  ts: { id: 'typescript', label: 'TypeScript', indent: 2 },
  mts: { id: 'typescript', label: 'TypeScript', indent: 2 },
  cts: { id: 'typescript', label: 'TypeScript', indent: 2 },
  tsx: { id: 'tsx', label: 'TypeScript React', indent: 2 },
  js: { id: 'javascript', label: 'JavaScript', indent: 2 },
  mjs: { id: 'javascript', label: 'JavaScript', indent: 2 },
  cjs: { id: 'javascript', label: 'JavaScript', indent: 2 },
  jsx: { id: 'jsx', label: 'JavaScript React', indent: 2 },
  json: { id: 'json', label: 'JSON', indent: 2 },
  jsonc: { id: 'json', label: 'JSON', indent: 2 },
  css: { id: 'css', label: 'CSS', indent: 2 },
  scss: { id: 'css', label: 'SCSS', indent: 2 },
  html: { id: 'html', label: 'HTML', indent: 2 },
  htm: { id: 'html', label: 'HTML', indent: 2 },
  svg: { id: 'html', label: 'SVG', indent: 2 },
  vue: { id: 'html', label: 'Vue', indent: 2 },
  svelte: { id: 'html', label: 'Svelte', indent: 2 },
  md: { id: 'markdown', label: 'Markdown', indent: 2 },
  mdx: { id: 'markdown', label: 'MDX', indent: 2 },
  py: { id: 'python', label: 'Python', indent: 4 },
  rs: { id: 'rust', label: 'Rust', indent: 4 },
  yml: { id: 'yaml', label: 'YAML', indent: 2 },
  yaml: { id: 'yaml', label: 'YAML', indent: 2 },
  toml: { id: 'toml', label: 'TOML', indent: 2 },
  sh: { id: 'shell', label: 'Shell', indent: 2 },
  bash: { id: 'shell', label: 'Shell', indent: 2 },
  zsh: { id: 'shell', label: 'Shell', indent: 2 },
};

const BY_NAME: Record<string, LanguageInfo> = {
  dockerfile: { id: 'shell', label: 'Dockerfile', indent: 2 },
  makefile: { id: 'shell', label: 'Makefile', indent: 4 },
  '.env': { id: 'shell', label: 'Env', indent: 2 },
  '.gitignore': { id: 'plain', label: 'Ignore', indent: 2 },
};

export function basenameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function dirnameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function extOf(path: string): string {
  const name = basenameOf(path);
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function languageFor(path: string): LanguageInfo {
  const name = basenameOf(path).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  return BY_EXT[extOf(path)] ?? { id: 'plain', label: 'Plain text', indent: 2 };
}

/** Indent width + unit sniffed from the first 200 lines (tabs win when they dominate). */
export function detectIndent(content: string, fallback = 2): { unit: 'spaces' | 'tabs'; width: number } {
  let tabs = 0;
  const counts = new Map<number, number>();
  const lines = content.split('\n', 200);
  for (const line of lines) {
    if (line.startsWith('\t')) tabs += 1;
    else {
      const m = /^( +)\S/.exec(line);
      if (m) {
        const n = m[1].length;
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
  }
  const spaced = [...counts.values()].reduce((a, b) => a + b, 0);
  if (tabs > spaced) return { unit: 'tabs', width: 4 };
  if (spaced === 0) return { unit: 'spaces', width: fallback };
  // The most common indent step is the gcd-ish smallest frequent width.
  const widths = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const top = widths[0]?.[0] ?? fallback;
  return { unit: 'spaces', width: top === 4 || top === 2 || top === 8 ? top : top % 4 === 0 ? 4 : top % 2 === 0 ? 2 : top };
}

/* ── File icons (ext-coloured) ─────────────────────────────────────────── */

export interface FileIcon {
  /** Short glyph for the tree (≤ 3 chars). */
  glyph: string;
  color: string;
}

export function fileIconFor(path: string, isDir = false): FileIcon {
  if (isDir) return { glyph: '▸', color: 'var(--text-tertiary)' };
  const name = basenameOf(path).toLowerCase();
  if (name === 'package.json') return { glyph: '{}', color: '#8CC84B' };
  if (name === 'cargo.toml') return { glyph: 'rs', color: '#DEA584' };
  if (name.startsWith('.env')) return { glyph: 'env', color: '#E5C07B' };
  if (name.startsWith('.git')) return { glyph: 'git', color: '#F05033' };
  if (name.endsWith('.lock') || name.endsWith('.lockb')) return { glyph: 'lock', color: 'var(--text-tertiary)' };
  switch (extOf(path)) {
    case 'ts':
    case 'mts':
    case 'cts':
      return { glyph: 'TS', color: '#3B82F6' };
    case 'tsx':
      return { glyph: 'TSX', color: '#3B82F6' };
    case 'js':
    case 'mjs':
    case 'cjs':
      return { glyph: 'JS', color: '#E5C07B' };
    case 'jsx':
      return { glyph: 'JSX', color: '#61DAFB' };
    case 'json':
    case 'jsonc':
      return { glyph: '{}', color: '#E5C07B' };
    case 'css':
    case 'scss':
      return { glyph: '#', color: '#A78BFA' };
    case 'html':
    case 'htm':
      return { glyph: '<>', color: '#F97316' };
    case 'svg':
      return { glyph: 'svg', color: '#F59E0B' };
    case 'md':
    case 'mdx':
      return { glyph: 'M↓', color: '#60A5FA' };
    case 'py':
      return { glyph: 'py', color: '#4ADE80' };
    case 'rs':
      return { glyph: 'rs', color: '#DEA584' };
    case 'yml':
    case 'yaml':
      return { glyph: 'y', color: '#F472B6' };
    case 'toml':
      return { glyph: 't', color: '#9CA3AF' };
    case 'sh':
    case 'bash':
    case 'zsh':
      return { glyph: '$', color: '#4ADE80' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'ico':
      return { glyph: 'img', color: '#C084FC' };
    default:
      return { glyph: '·', color: 'var(--text-tertiary)' };
  }
}

/* ── Tree ──────────────────────────────────────────────────────────────── */

export interface TreeEntry {
  rel: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
  mtimeMs: number;
  heavy?: true;
}

export interface TreeNode extends TreeEntry {
  depth: number;
  children: TreeNode[];
}

/** Flat engine entries → nested, folders first, case-insensitive A→Z. */
export function buildTree(entries: readonly TreeEntry[]): TreeNode[] {
  const byRel = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const sorted = [...entries].sort((a, b) => a.rel.split('/').length - b.rel.split('/').length);
  for (const e of sorted) {
    const node: TreeNode = { ...e, depth: e.rel.split('/').length - 1, children: [] };
    byRel.set(e.rel, node);
    const parent = byRel.get(dirnameOf(e.rel));
    if (parent && e.rel.includes('/')) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1));
    for (const n of nodes) if (n.children.length) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

/** Visible rows for a tree given the expanded set (pre-order). */
export function flattenTree(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: readonly TreeNode[]): void => {
    for (const n of list) {
      out.push(n);
      if (n.type === 'dir' && expanded.has(n.rel)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Every ancestor folder of `rel` (so revealing a file can expand them). */
export function ancestorsOf(rel: string): string[] {
  const parts = rel.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'));
  return out;
}

/* ── Fuzzy matching (Quick Open) ───────────────────────────────────────── */

export interface FuzzyHit {
  score: number;
  /** Indexes into `text` that matched (for highlighting). */
  positions: number[];
}

/**
 * Subsequence match with VS Code-ish scoring: consecutive runs, word/path
 * boundaries and basename hits score higher; later gaps cost a little.
 * Returns null when `query` is not a subsequence of `text`.
 */
export function fuzzyMatch(query: string, text: string): FuzzyHit | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let lastHit = -2;
  const baseStart = text.lastIndexOf('/') + 1;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi];
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return null;
    positions.push(idx);
    let gain = 1;
    if (idx === lastHit + 1) gain += 3;
    if (idx === 0 || /[/._\-\s]/.test(text[idx - 1] ?? '')) gain += 2;
    if (idx >= baseStart) gain += 1;
    if (text[idx] !== t[idx] && qi > 0 && positions.length > 1 && /[a-z]/.test(text[idx - 1] ?? '')) gain += 1; // camelCase hump
    score += gain - Math.min(2, Math.max(0, idx - lastHit - 1) * 0.1);
    lastHit = idx;
    ti = idx + 1;
  }
  score -= (text.length - q.length) * 0.01;
  return { score, positions };
}

export function rankFiles(query: string, paths: readonly string[], limit = 50): Array<{ path: string; hit: FuzzyHit }> {
  const out: Array<{ path: string; hit: FuzzyHit }> = [];
  for (const path of paths) {
    const hit = fuzzyMatch(query, path);
    if (hit) out.push({ path, hit });
  }
  out.sort((a, b) => b.hit.score - a.hit.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return out.slice(0, limit);
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

/** Move `path` to the front of the most-recently-used list (bounded). */
export function touchMru(mru: readonly string[], path: string, cap = 50): string[] {
  return [path, ...mru.filter((p) => p !== path)].slice(0, cap);
}

/** Ctrl+Tab target: the next entry after the active one in MRU order, wrapping. */
export function nextMru(mru: readonly string[], open: readonly string[], active: string | null, step = 1): string | null {
  const order = mru.filter((p) => open.includes(p)).concat(open.filter((p) => !mru.includes(p)));
  if (order.length === 0) return null;
  const i = active ? order.indexOf(active) : -1;
  const n = (i + step + order.length) % order.length;
  return order[n] ?? null;
}

/** Tab titles: duplicates get their parent folder as a hint ("index.ts · src/a"). */
export function tabTitles(paths: readonly string[]): Map<string, { title: string; hint: string | null }> {
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(basenameOf(p), (counts.get(basenameOf(p)) ?? 0) + 1);
  const out = new Map<string, { title: string; hint: string | null }>();
  for (const p of paths) {
    const base = basenameOf(p);
    out.set(p, { title: base, hint: (counts.get(base) ?? 0) > 1 ? dirnameOf(p) || '.' : null });
  }
  return out;
}

/* ── Panes ─────────────────────────────────────────────────────────────── */

export const PANES = {
  chat: { key: 'xr.builder.panes.chat', min: 280, max: 480, default: 360 },
  preview: { key: 'xr.builder.panes.preview', min: 320, max: 520, default: 400 },
  tree: { key: 'xr.builder.panes.tree', min: 180, max: 360, default: 240 },
  /** Console height as a fraction of the preview column (0–0.5). */
  console: { key: 'xr.builder.panes.console', min: 0, max: 0.5, default: 0 },
  terminal: { key: 'xr.builder.panes.terminal', min: 120, max: 600, default: 220 },
} as const;

export function clampPane(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
}

/** 28 % of the window, inside the pane's bounds. */
export function defaultPaneWidth(windowWidth: number, pane: 'chat' | 'preview'): number {
  const p = PANES[pane];
  return clampPane(Math.round(windowWidth * 0.28), p.min, p.max);
}

/* ── Unified diffs in chat markdown ────────────────────────────────────── */

export interface DiffHunkView {
  index: number;
  header: string;
  lines: string[];
  added: number;
  removed: number;
}

export interface DiffBlock {
  /** Root-relative target path (null when the model gave none). */
  path: string | null;
  /** The raw unified diff for this ONE file (what the engine receives). */
  patch: string;
  hunks: DiffHunkView[];
  isNewFile: boolean;
  isDelete: boolean;
}

export type ChatSegment = { kind: 'text'; text: string } | { kind: 'diff'; block: DiffBlock };

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripPrefix(p: string): string {
  let s = p.trim().replace(/\t.*$/, '');
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  if (s === '/dev/null') return s;
  s = s.replace(/^[ab]\//, '').replace(/^\.\//, '');
  return s;
}

/** Parse one file's diff text into hunks (loose headers accepted, like the engine). */
export function parseDiffHunks(diff: string): DiffHunkView[] {
  const hunks: DiffHunkView[] = [];
  let cur: DiffHunkView | null = null;
  for (const raw of diff.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('@@')) {
      const m = HUNK_RE.exec(raw);
      cur = { index: hunks.length, header: m ? raw : `@@ -1,0 +1,0 @@${raw.replace(/^@@+\s*(?:[^@]*@@)?/, '').trim() ? ` ${raw.replace(/^@@+\s*(?:[^@]*@@)?/, '').trim()}` : ''}`, lines: [], added: 0, removed: 0 };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('diff --git') || raw.startsWith('--- ') || raw.startsWith('+++ ')) continue;
    cur.lines.push(raw);
    if (raw.startsWith('+')) cur.added += 1;
    else if (raw.startsWith('-')) cur.removed += 1;
  }
  // Drop a trailing empty context line that a fence's final newline produced.
  for (const h of hunks) while (h.lines.length && h.lines[h.lines.length - 1] === '') h.lines.pop();
  return hunks.filter((h) => h.lines.length > 0);
}

/** Split a fenced diff body into per-file blocks (multi-file diffs are common). */
export function splitDiffFiles(body: string, hintPath: string | null): DiffBlock[] {
  const text = body.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  interface FileAcc {
    path: string | null;
    lines: string[];
    oldPath: string | null;
    newPath: string | null;
  }
  const files: FileAcc[] = [];
  const push = (): FileAcc => {
    const f: FileAcc = { path: null, lines: [], oldPath: null, newPath: null };
    files.push(f);
    return f;
  };
  const current = (): FileAcc => {
    const last = files[files.length - 1];
    return last && !last.lines.some((l) => l.startsWith('@@')) ? last : push();
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (line.startsWith('diff --git ')) {
      const cur = current();
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (m) cur.path = m[2] ?? null;
      cur.lines.push(line);
      continue;
    }
    if (line.startsWith('--- ') && next.startsWith('+++ ')) {
      const cur = current();
      cur.oldPath = stripPrefix(line.slice(4));
      cur.newPath = stripPrefix(next.slice(4));
      cur.path = cur.newPath !== '/dev/null' ? cur.newPath : cur.oldPath;
      cur.lines.push(line, next);
      i += 1;
      continue;
    }
    const cur = files[files.length - 1] ?? push();
    cur.lines.push(line);
  }
  return files
    .map((f) => {
      const hunks = parseDiffHunks(f.lines.join('\n'));
      const path = f.path && f.path !== '/dev/null' ? f.path : hintPath;
      return {
        path,
        patch: f.lines.join('\n').replace(/\n*$/, '\n'),
        hunks,
        isNewFile: f.oldPath === '/dev/null',
        isDelete: f.newPath === '/dev/null',
      };
    })
    .filter((b) => b.hunks.length > 0);
}

const FENCE_RE = /```([a-zA-Z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;
const PATH_HINT_RE = /(?:^|\n)[^\n]*?(?:\*\*|`|#+\s*|File:\s*|file:\s*)?([\w./-]+\.[A-Za-z0-9]{1,8})`?\*?\*?:?\s*$/;

/**
 * Assistant markdown → text segments and diff blocks. A ```diff / ```patch
 * fence becomes one block per file; the path comes from the diff headers or,
 * failing that, from the line just above the fence ("**src/app.ts**").
 */
export function segmentAssistantMarkdown(markdown: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  let last = 0;
  for (const m of markdown.matchAll(FENCE_RE)) {
    const lang = (m[1] ?? '').toLowerCase();
    const body = m[2] ?? '';
    const isDiff = lang === 'diff' || lang === 'patch' || (!lang && /^(?:--- |\+\+\+ |@@ )/m.test(body));
    if (!isDiff) continue;
    const before = markdown.slice(last, m.index);
    const hint = PATH_HINT_RE.exec(before.trimEnd().split('\n').slice(-2).join('\n'))?.[1] ?? null;
    const blocks = splitDiffFiles(body, hint);
    if (blocks.length === 0) continue;
    if (before.trim()) out.push({ kind: 'text', text: before });
    for (const block of blocks) out.push({ kind: 'diff', block });
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = markdown.slice(last);
  if (tail.trim() || out.length === 0) out.push({ kind: 'text', text: tail });
  return out;
}

/** Only the selected hunks, as a patch the engine can apply (indexes are 0-based). */
export function selectedPatch(block: DiffBlock, selected: ReadonlySet<number>): string {
  const head = block.path ? `--- a/${block.path}\n+++ b/${block.path}\n` : '';
  const hunks = block.hunks.filter((h) => selected.has(h.index));
  return head + hunks.map((h) => [h.header, ...h.lines].join('\n')).join('\n') + '\n';
}

/* ── file:line links ───────────────────────────────────────────────────── */

export interface FileLink {
  text: string;
  path: string;
  line: number | null;
  col: number | null;
  start: number;
  end: number;
}

const FILE_LINK_RE = /(?<![\w/])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,8})(?::(\d+)(?::(\d+))?)?(?![\w/])/g;

/** `src/app.ts:24:7`-style references in plain text, only for paths the project has. */
export function findFileLinks(text: string, known: ReadonlySet<string>): FileLink[] {
  const out: FileLink[] = [];
  for (const m of text.matchAll(FILE_LINK_RE)) {
    const path = m[1] ?? '';
    if (!known.has(path)) continue;
    out.push({
      text: m[0],
      path,
      line: m[2] ? Number(m[2]) : null,
      col: m[3] ? Number(m[3]) : null,
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }
  return out;
}

/* ── Console ───────────────────────────────────────────────────────────── */

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

export function classifyConsoleLine(line: string, stream: 'stdout' | 'stderr' | 'system'): ConsoleLevel {
  const l = line.toLowerCase();
  if (/\b(error|err!|exception|failed|fatal|unhandled|cannot find|not found|eaddrinuse)\b/.test(l) || /^\s*(✖|✘|×)/.test(line)) return 'error';
  if (/\b(warn|warning|deprecat)/.test(l) || /^\s*(⚠|!)/.test(line)) return 'warn';
  if (stream === 'system' || /\b(ready|listening|compiled|started|serving|hmr)\b|local:|➜|✓/.test(l)) return 'info';
  return stream === 'stderr' ? 'warn' : 'log';
}

export function formatReady(ms: number): string {
  return ms >= 1000 ? `Ready in ${(ms / 1000).toFixed(1)}s` : `Ready in ${Math.round(ms)}ms`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ── Model context ─────────────────────────────────────────────────────── */

export const BUILDER_SYSTEM_RULES = [
  'You are XR working inside the Builder, a code editor with a live preview. The user reviews every change before it is written.',
  'When you propose code changes, answer with UNIFIED DIFF patches inside ```diff fences — one fence per file, starting with `--- a/<path>` and `+++ b/<path>` (root-relative), then `@@` hunks with 2–3 lines of real surrounding context. Never paste whole files for edits; for a brand-new file use `--- /dev/null` and a single hunk of added lines.',
  'Keep prose short and specific. Refer to code as path:line (for example src/App.tsx:24) so the editor can jump to it. Do not claim to have run or applied anything — the user applies diffs.',
].join('\n');

export interface BuilderContextInput {
  projectName: string;
  root: string;
  activePath: string | null;
  activeContent: string | null;
  cursorLine: number | null;
  selection: string | null;
  openFiles: readonly string[];
  terminalTail: readonly string[];
  git: { branch: string | null; dirty: boolean; changed: readonly string[] } | null;
  devServer: { state: string; url: string | null } | null;
}

const CONTEXT_BUDGET = 12_000;

/** The system context for one Builder turn (bounded; the active file is excerpted around the cursor). */
export function builderContextText(input: BuilderContextInput): string {
  const parts: string[] = [BUILDER_SYSTEM_RULES, `Project: ${input.projectName} (root ${input.root}).`];
  if (input.git) {
    const changed = input.git.changed.slice(0, 20).join(', ');
    parts.push(`Git: branch ${input.git.branch ?? '(none)'}, ${input.git.dirty ? `uncommitted changes${changed ? ` in ${changed}` : ''}` : 'clean'}.`);
  }
  if (input.devServer) parts.push(`Dev server: ${input.devServer.state}${input.devServer.url ? ` at ${input.devServer.url}` : ''}.`);
  if (input.openFiles.length) parts.push(`Open files: ${input.openFiles.map((p) => `${p} (${languageFor(p).label})`).join(', ')}.`);
  if (input.selection && input.selection.trim()) parts.push(`Selected text in ${input.activePath ?? 'the editor'}:\n\`\`\`\n${input.selection.slice(0, 3000)}\n\`\`\``);
  if (input.activePath && input.activeContent !== null) {
    const used = parts.join('\n\n').length;
    const room = Math.max(1500, CONTEXT_BUDGET - used - 600);
    const excerpt = excerptAround(input.activeContent, input.cursorLine, room);
    parts.push(`Active file ${input.activePath}${excerpt.partial ? ` (lines ${excerpt.from}–${excerpt.to} of ${excerpt.total}; numbered)` : ' (complete; numbered)'}:\n\`\`\`\n${excerpt.text}\n\`\`\``);
  }
  if (input.terminalTail.length) parts.push(`Last terminal/dev-server lines:\n${input.terminalTail.slice(-20).join('\n').slice(0, 2000)}`);
  return parts.join('\n\n').slice(0, CONTEXT_BUDGET + 2000);
}

/** Numbered excerpt centred on `line`, within `budget` characters. */
export function excerptAround(content: string, line: number | null, budget: number): { text: string; from: number; to: number; total: number; partial: boolean } {
  const lines = content.split('\n');
  const total = lines.length;
  const numbered = (i: number) => `${String(i + 1).padStart(4, ' ')}  ${lines[i] ?? ''}`;
  let size = 0;
  const all = lines.map((_, i) => numbered(i));
  for (const l of all) size += l.length + 1;
  if (size <= budget) return { text: all.join('\n'), from: 1, to: total, total, partial: false };
  const centre = Math.min(total - 1, Math.max(0, (line ?? 1) - 1));
  let from = centre;
  let to = centre;
  let used = all[centre]?.length ?? 0;
  while (used < budget && (from > 0 || to < total - 1)) {
    let grew = false;
    if (from > 0 && used + (all[from - 1]?.length ?? 0) + 1 <= budget) {
      from -= 1;
      used += (all[from]?.length ?? 0) + 1;
      grew = true;
    }
    if (to < total - 1 && used + (all[to + 1]?.length ?? 0) + 1 <= budget) {
      to += 1;
      used += (all[to]?.length ?? 0) + 1;
      grew = true;
    }
    if (!grew) break;
  }
  return { text: all.slice(from, to + 1).join('\n'), from: from + 1, to: to + 1, total, partial: true };
}

/* ── Misc ──────────────────────────────────────────────────────────────── */

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Builder session id for a workspace — one persistent thread per project. */
export function builderSessionId(workspaceId: string): string {
  return `builder:${workspaceId}`;
}

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';
export const DEVICE_WIDTHS: Record<PreviewDevice, number | null> = { desktop: null, tablet: 768, mobile: 375 };

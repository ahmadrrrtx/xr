/**
 * Phase 23 — project context for the coding agent.
 *
 * Everything here is read-only and bounded:
 *   - project rules  (.xr/rules.md, else AGENTS.md / .cursorrules / .clinerules / .github/CLAUDE.md)
 *   - repo map       (git-tracked + untracked-but-not-ignored files; .xrignore honoured)
 *   - git state      (branch, short status, diff stat)
 *   - project type   (package.json / Cargo.toml / pyproject.toml / go.mod / …)
 *   - @references    (@file, @file:10-40, @dir/) expanded into the user's prompt
 */
import { execFile } from "node:child_process";
import { promises as fsp, existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, isAbsolute, sep, basename } from "node:path";

export const RULES_CANDIDATES = [".xr/rules.md", "AGENTS.md", ".cursorrules", ".clinerules", ".github/CLAUDE.md"] as const;
const RULES_MAX_CHARS = 32_000;
const TREE_FULL_LIMIT = 500;
const TREE_LIST_LIMIT = 400;
const FILE_CAP = 20_000;
const REF_MAX_CHARS = 60_000;
const DIR_REF_MAX_FILES = 10;
const DIR_REF_MAX_FILE_CHARS = 20_000;

/** Directories never walked, git or not. */
const ALWAYS_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "target", "coverage", ".next", ".turbo", ".cache", "__pycache__", ".venv", "venv"]);

export interface ProjectRules {
  source: string;
  text: string;
  truncated: boolean;
}

/** First rules file that exists, honouring the fallback order. Never throws. */
export function loadProjectRules(cwd: string): ProjectRules | null {
  for (const rel of RULES_CANDIDATES) {
    const p = join(cwd, rel);
    if (!existsSync(p)) continue;
    try {
      if (!statSync(p).isFile()) continue;
      const raw = readFileSync(p, "utf8");
      const truncated = raw.length > RULES_MAX_CHARS;
      return { source: rel, text: truncated ? raw.slice(0, RULES_MAX_CHARS) : raw, truncated };
    } catch {
      continue;
    }
  }
  return null;
}

// ── .xrignore ─────────────────────────────────────────────────────────────────

/** Compile `.xrignore` lines (gitignore-ish subset) into predicates on relative paths. */
export function compileIgnore(lines: string[]): (rel: string) => boolean {
  const rules: RegExp[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const anchored = line.startsWith("/");
    const body = anchored ? line.slice(1) : line;
    const dirOnly = body.endsWith("/");
    const core = dirOnly ? body.slice(0, -1) : body;
    const esc = core
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "\u0000")
      .replace(/\*\*/g, "\u0001")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\u0000/g, "(?:.*/)?")
      .replace(/\u0001/g, ".*");
    const prefix = anchored ? "^" : "(?:^|.*/)";
    // Matches the path itself or anything under it.
    rules.push(new RegExp(`${prefix}${esc}(?:/.*)?$`));
  }
  return (rel: string) => rules.some((r) => r.test(rel));
}

/** Lines of an ignore file in the project root (missing file → no rules). */
async function readIgnoreFile(cwd: string, name: string): Promise<string[]> {
  try {
    return (await fsp.readFile(join(cwd, name), "utf8")).split("\n");
  } catch {
    return [];
  }
}

// ── File listing ──────────────────────────────────────────────────────────────

function runGit(args: string[], cwd: string, timeoutMs = 8_000): Promise<string | null> {
  return new Promise((done) => {
    execFile("git", args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      done(err ? null : String(stdout));
    });
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const out = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return out !== null && out.trim() === "true";
}

/**
 * Files in the project, relative to `cwd`, honouring .gitignore (through git) and
 * .xrignore. Outside a git repo, a bounded walk skips the usual generated trees.
 */
export async function listProjectFiles(cwd: string): Promise<{ files: string[]; truncated: boolean; viaGit: boolean }> {
  const inGit = await isGitRepo(cwd);
  const gitOut = inGit ? await runGit(["ls-files", "-co", "--exclude-standard", "-z"], cwd, 20_000) : null;
  // Outside git nothing else applies .gitignore, so the coder reads it too (root file only).
  const ignore = compileIgnore([
    ...(await readIgnoreFile(cwd, ".xrignore")),
    ...(gitOut === null ? await readIgnoreFile(cwd, ".gitignore") : []),
  ]);
  let files: string[];
  let viaGit = false;
  if (gitOut !== null) {
    viaGit = true;
    files = gitOut.split("\u0000").filter(Boolean);
  } else {
    files = await walkFiles(cwd, FILE_CAP * 2);
  }
  let filtered = files.filter((f) => !ignore(f) && !f.split("/").some((seg) => ALWAYS_SKIP_DIRS.has(seg)));
  filtered = filtered.map((f) => f.split(sep).join("/")).sort();
  const truncated = filtered.length > FILE_CAP;
  return { files: truncated ? filtered.slice(0, FILE_CAP) : filtered, truncated, viaGit };
}

async function walkFiles(root: string, max: number): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!ALWAYS_SKIP_DIRS.has(e.name)) stack.push(join(dir, e.name));
      } else if (e.isFile()) {
        out.push(relative(root, join(dir, e.name)));
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

export interface RepoMap {
  total: number;
  /** "tree" for small repos (file list), "summary" for large ones. */
  mode: "tree" | "summary";
  text: string;
  languages: Array<{ ext: string; count: number }>;
}

/** Build the repo map text. `deep` forces the full tree even for large repos. */
export function buildRepoMap(files: string[], deep: boolean): RepoMap {
  const counts = new Map<string, number>();
  for (const f of files) {
    const base = basename(f);
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "(none)";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  const languages = [...counts.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  if (files.length < TREE_FULL_LIMIT || deep) {
    const shown = files.slice(0, TREE_LIST_LIMIT);
    const more = files.length - shown.length;
    const text = shown.join("\n") + (more > 0 ? `\n… ${more} more files` : "");
    return { total: files.length, mode: "tree", text, languages };
  }

  const topDirs = new Map<string, number>();
  for (const f of files) {
    const top = f.includes("/") ? f.split("/")[0]! + "/" : f;
    topDirs.set(top, (topDirs.get(top) ?? 0) + 1);
  }
  const top = [...topDirs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([name, n]) => `${name} (${n})`)
    .join("\n");
  return { total: files.length, mode: "summary", text: top, languages };
}

// ── Git & project type ────────────────────────────────────────────────────────

export interface GitSnapshot {
  branch: string;
  status: string[];
  diffStat: string;
}

export async function gitSnapshot(cwd: string): Promise<GitSnapshot | null> {
  if (!(await isGitRepo(cwd))) return null;
  const branch = ((await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd)) ?? "").trim() || "(detached)";
  const status = ((await runGit(["status", "--short"], cwd)) ?? "")
    .split("\n")
    .filter(Boolean)
    .slice(0, 30);
  const diffStat = ((await runGit(["diff", "--stat"], cwd)) ?? "").trim().split("\n").slice(-1)[0] ?? "";
  return { branch, status, diffStat };
}

export interface ProjectInfo {
  kinds: string[];
  scripts: string[];
  name?: string;
}

/** Detect the project type(s) and the build/test commands worth knowing. Never throws. */
export function detectProject(cwd: string): ProjectInfo {
  const kinds: string[] = [];
  const scripts: string[] = [];
  let name: string | undefined;
  const has = (f: string) => existsSync(join(cwd, f));
  if (has("package.json")) {
    kinds.push("node");
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { name?: string; scripts?: Record<string, string> };
      name = pkg.name;
      for (const k of Object.keys(pkg.scripts ?? {}).slice(0, 15)) scripts.push(`npm run ${k}`);
    } catch {
      /* malformed package.json: still a node project */
    }
  }
  if (has("bun.lock") || has("bun.lockb")) kinds.push("bun");
  if (has("tsconfig.json")) kinds.push("typescript");
  if (has("Cargo.toml")) kinds.push("rust");
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) kinds.push("python");
  if (has("go.mod")) kinds.push("go");
  if (has("Gemfile")) kinds.push("ruby");
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) kinds.push("jvm");
  if (has("Makefile")) kinds.push("make");
  if (has("Dockerfile")) kinds.push("docker");
  return { kinds, scripts, ...(name ? { name } : {}) };
}

// ── @references ───────────────────────────────────────────────────────────────

export interface ExpandedPrompt {
  /** The prompt with referenced content prepended as <file> blocks. */
  prompt: string;
  /** Human-readable list of what was attached (for the banner / summary). */
  attached: string[];
  /** @-tokens that did not resolve to anything in the project. */
  missing: string[];
}

const REF_RE = /(^|\s)@([^\s@]+)/g;

/**
 * Expand `@path`, `@path:10-40` and `@dir/` references. A token that does not
 * resolve inside the project is left as plain text (so emails and handles are fine)
 * and reported in `missing`.
 */
export async function expandReferences(prompt: string, cwd: string): Promise<ExpandedPrompt> {
  const attached: string[] = [];
  const missing: string[] = [];
  const blocks: string[] = [];
  let used = 0;

  const matches = [...prompt.matchAll(REF_RE)];
  for (const m of matches) {
    // Trailing sentence punctuation is not part of the reference ("see @a.ts.").
    const raw = m[2]!.replace(/[),.;!?]+$/, "");
    let spec = raw;
    let range: { from: number; to: number } | null = null;
    const rm = /^(.*?):(\d+)(?:-(\d+))?$/.exec(raw);
    if (rm && existsSync(resolve(cwd, rm[1]!))) {
      spec = rm[1]!;
      const from = Number(rm[2]);
      const to = rm[3] ? Number(rm[3]) : from;
      range = { from, to };
    }
    const abs = isAbsolute(spec) ? spec : resolve(cwd, spec);
    const rel = relative(cwd, abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      missing.push(raw);
      continue;
    }
    if (!existsSync(abs)) {
      missing.push(raw);
      continue;
    }
    const st = statSync(abs);
    if (st.isDirectory()) {
      const entries = (await fsp.readdir(abs, { withFileTypes: true })).filter((e) => e.isFile()).slice(0, DIR_REF_MAX_FILES);
      const listing = (await fsp.readdir(abs)).slice(0, 200).join("\n");
      const bodies: string[] = [];
      for (const e of entries) {
        const p = join(abs, e.name);
        const body = await fsp.readFile(p, "utf8").catch(() => null);
        if (body === null || body.includes("\u0000")) continue;
        const clipped = body.length > DIR_REF_MAX_FILE_CHARS ? body.slice(0, DIR_REF_MAX_FILE_CHARS) + "\n…(truncated)" : body;
        bodies.push(`<file path="${relative(cwd, p).split(sep).join("/")}">\n${clipped}\n</file>`);
      }
      const block = `<directory path="${rel.split(sep).join("/") || "."}">\n${listing}\n</directory>\n${bodies.join("\n")}`;
      if (used + block.length > REF_MAX_CHARS) continue;
      used += block.length;
      blocks.push(block);
      attached.push(`${rel || "."}/ (${bodies.length} file${bodies.length === 1 ? "" : "s"})`);
      continue;
    }
    if (!st.isFile()) {
      missing.push(raw);
      continue;
    }
    const text = await fsp.readFile(abs, "utf8").catch(() => null);
    if (text === null || text.includes("\u0000")) {
      missing.push(raw);
      continue;
    }
    let body = text;
    let label = rel.split(sep).join("/");
    if (range) {
      const lines = text.split("\n");
      const from = Math.max(1, range.from);
      const to = Math.min(lines.length, range.to);
      body = lines.slice(from - 1, to).join("\n");
      label += `:${from}-${to}`;
    }
    const clipped = body.length > REF_MAX_CHARS ? body.slice(0, REF_MAX_CHARS) + "\n…(truncated)" : body;
    if (used + clipped.length > REF_MAX_CHARS) continue;
    used += clipped.length;
    blocks.push(`<file path="${label}">\n${clipped}\n</file>`);
    attached.push(label);
  }

  if (!blocks.length) return { prompt, attached, missing };
  return { prompt: `${blocks.join("\n\n")}\n\n${prompt}`, attached, missing };
}

/** Gather everything the system prompt needs about the project. */
export interface ProjectContext {
  rules: ProjectRules | null;
  repo: RepoMap | null;
  git: GitSnapshot | null;
  project: ProjectInfo;
  cwd: string;
}

export async function gatherProjectContext(cwd: string, opts: { deepTree: boolean }): Promise<{ ctx: ProjectContext; large: boolean }> {
  const rules = loadProjectRules(cwd);
  const { files, truncated } = await listProjectFiles(cwd);
  const repo = files.length ? buildRepoMap(files, opts.deepTree) : null;
  const git = await gitSnapshot(cwd);
  const project = detectProject(cwd);
  return {
    ctx: { rules, repo, git, project, cwd },
    large: files.length >= TREE_FULL_LIMIT || truncated,
  };
}

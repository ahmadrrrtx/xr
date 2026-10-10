/**
 * Project context for the coder CLI: rules files, project type, git state,
 * a bounded repo map, and the system prompt that carries them.
 *
 * Everything here is read-only and bounded. Git is queried with a timeout;
 * the file walk is capped; oversized rules files are truncated with a note.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const RULES_CANDIDATES = [
  ".xr/rules.md",
  "AGENTS.md",
  ".cursorrules",
  ".clinerules",
  ".github/CLAUDE.md",
  "CLAUDE.md",
] as const;

const MAX_RULES_BYTES = 32_000;
const MAX_FILES = 5_000;
export const LARGE_REPO_FILES = 500;
const ALWAYS_SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", "out", "target", ".next", ".venv", "__pycache__"]);

export interface RulesFile {
  source: string;
  content: string;
  truncated: boolean;
}

/** First rules file that exists wins (one only, to avoid conflicting instructions). */
export function loadProjectRules(cwd: string): RulesFile | null {
  for (const candidate of RULES_CANDIDATES) {
    const path = join(cwd, candidate);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    const raw = readFileSync(path, "utf8");
    const truncated = raw.length > MAX_RULES_BYTES;
    return { source: candidate, content: truncated ? raw.slice(0, MAX_RULES_BYTES) : raw, truncated };
  }
  return null;
}

export interface ProjectType {
  kinds: string[];
  scripts: string[];
  name?: string;
}

export function detectProjectType(cwd: string): ProjectType {
  const kinds: string[] = [];
  let scripts: string[] = [];
  let name: string | undefined;
  const has = (f: string) => existsSync(join(cwd, f));
  if (has("package.json")) {
    kinds.push("node");
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      name = pkg.name;
      scripts = Object.keys(pkg.scripts ?? {}).slice(0, 30);
    } catch {
      // Malformed package.json: still a node project, just without scripts.
    }
  }
  if (has("bun.lock") || has("bun.lockb")) kinds.push("bun");
  if (has("Cargo.toml")) kinds.push("rust");
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) kinds.push("python");
  if (has("go.mod")) kinds.push("go");
  if (has("Gemfile")) kinds.push("ruby");
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) kinds.push("jvm");
  if (has("Makefile")) kinds.push("make");
  if (has("deno.json") || has("deno.jsonc")) kinds.push("deno");
  return { kinds, scripts, ...(name ? { name } : {}) };
}

export interface GitState {
  isRepo: boolean;
  branch?: string;
  status: string[];
  diffStat?: string;
}

function git(cwd: string, args: string[]): string | null {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 5000 });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout;
}

export function gitState(cwd: string): GitState {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside === null || inside.trim() !== "true") return { isRepo: false, status: [] };
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
  const status = (git(cwd, ["status", "--short"]) ?? "").split("\n").filter(Boolean).slice(0, 30);
  const diffStat = (git(cwd, ["diff", "--stat"]) ?? "").trim();
  return {
    isRepo: true,
    ...(branch ? { branch } : {}),
    status,
    ...(diffStat ? { diffStat: diffStat.split("\n").slice(-12).join("\n") } : {}),
  };
}

/** Compile a simple `.gitignore` / `.xrignore` pattern to a RegExp on relative paths. */
export function compileIgnore(patterns: string[]): RegExp[] {
  return patterns
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && !p.startsWith("!"))
    .map((p) => {
      const anchored = p.startsWith("/");
      const body = p.replace(/^\//, "").replace(/\/$/, "");
      const esc = body
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\u0000/g, ".*");
      const prefix = anchored || body.includes("/") ? "^" : "(^|/)";
      return new RegExp(`${prefix}${esc}(/|$)`);
    });
}

function readIgnoreFile(cwd: string, name: string): string[] {
  const path = join(cwd, name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n");
}

/** Project files, honoring .gitignore (via git when available) and .xrignore. */
export function listProjectFiles(cwd: string, limit = MAX_FILES): string[] {
  const xrIgnore = compileIgnore(readIgnoreFile(cwd, ".xrignore"));
  let files: string[];
  const tracked = git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard"]);
  if (tracked !== null) {
    files = tracked.split("\n").filter(Boolean);
  } else {
    const gitignore = compileIgnore(readIgnoreFile(cwd, ".gitignore"));
    files = [];
    walk(cwd, "", files, gitignore, limit);
  }
  return files.filter((f) => !xrIgnore.some((re) => re.test(f.split(sep).join("/")))).slice(0, limit);
}

function walk(root: string, rel: string, out: string[], ignore: RegExp[], limit: number): void {
  if (out.length >= limit) return;
  const dir = join(root, rel);
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= limit) return;
    const childRel = rel ? `${rel}/${name}` : name;
    if (ALWAYS_SKIP.has(name) || ignore.some((re) => re.test(childRel))) continue;
    const full = join(root, childRel);
    const st = statSync(full);
    if (st.isDirectory()) walk(root, childRel, out, ignore, limit);
    else out.push(childRel);
  }
}

/** Shallow repo map. Small repos get a tree; large ones get counts and top-level entries. */
export function repoMap(files: string[]): string {
  if (files.length === 0) return "(no files)";
  if (files.length >= LARGE_REPO_FILES) {
    const top = new Map<string, number>();
    const langs = new Map<string, number>();
    for (const f of files) {
      const first = f.includes("/") ? `${f.split("/")[0]}/` : f;
      top.set(first, (top.get(first) ?? 0) + 1);
      const ext = f.includes(".") ? f.slice(f.lastIndexOf(".") + 1) : "(none)";
      langs.set(ext, (langs.get(ext) ?? 0) + 1);
    }
    const topList = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `  ${k} (${v})`);
    const langList = [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`);
    return [
      `${files.length.toLocaleString("en-US")} files (large repo: full tree not loaded; use @folder/ to add a directory).`,
      "Top-level:",
      ...topList,
      `Extensions: ${langList.join(" ")}`,
    ].join("\n");
  }
  return files.slice(0, LARGE_REPO_FILES).join("\n");
}

export interface PromptInput {
  cwd: string;
  rules: RulesFile | null;
  project: ProjectType;
  git: GitState;
  files: string[];
  readOnly: boolean;
}

export const BASE_SYSTEM_PROMPT = [
  "You are xr, a coding agent running in the user's terminal.",
  "You edit files and run commands to achieve the user's task.",
  "You prefer reading before editing. Prefer small, targeted edits over full rewrites.",
  "Every file write and shell command is shown to the user for approval before it runs; respect a denial and try another approach.",
  "Be concise. When done, summarize what you changed and how you verified it.",
].join("\n");

export function buildSystemPrompt(input: PromptInput): string {
  const parts: string[] = [BASE_SYSTEM_PROMPT];
  if (input.readOnly) {
    parts.push("This session is READ-ONLY: you cannot edit files or run commands. Answer from the code you can read.");
  }
  if (input.rules) {
    parts.push(`## Project rules (${input.rules.source})\n${input.rules.content}${input.rules.truncated ? "\n…(truncated)" : ""}`);
  }
  const proj: string[] = [];
  proj.push(`Working directory: ${input.cwd}`);
  if (input.project.kinds.length) proj.push(`Project type: ${input.project.kinds.join(", ")}`);
  if (input.project.name) proj.push(`Package: ${input.project.name}`);
  if (input.project.scripts.length) proj.push(`npm scripts: ${input.project.scripts.join(", ")}`);
  if (input.git.isRepo) {
    proj.push(`Git branch: ${input.git.branch ?? "(detached)"}`);
    if (input.git.status.length) proj.push(`Uncommitted changes:\n${input.git.status.join("\n")}`);
    if (input.git.diffStat) proj.push(`Diff stat:\n${input.git.diffStat}`);
  }
  proj.push(`Repository files:\n${repoMap(input.files)}`);
  parts.push(`## Project context\n${proj.join("\n")}`);
  return parts.join("\n\n");
}

export function displayPath(cwd: string, abs: string): string {
  const rel = relative(cwd, abs);
  return rel === "" ? "." : rel.split(sep).join("/");
}

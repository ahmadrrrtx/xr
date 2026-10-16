/**
 * XR — local RAG + codebase fingerprint.
 * Indexes a project into chunks (with embeddings) so the agent retrieves only
 * the relevant pieces — 10x larger effective codebase at the same token cost.
 * All local, all private. (Block 4.)
 */
import { withFilesystem, readWorkspaceText } from "../../security/filesystem.ts";
import { isSecretPath } from "../../security/guard.ts";
import { join, relative, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "../../state/workspace-store.ts";
import { embed, cosine, lexicalVector, sameSpace } from "./embed.ts";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "__pycache__", ".venv", "target", ".cache", ".xr",
]);
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".c", ".cpp", ".h", ".md", ".json", ".toml", ".yaml", ".yml", ".sh", ".css",
  ".html", ".sql", ".txt",
]);
const MAX_FILE_BYTES = 200_000;
const CHUNK_CHARS = 1200;

function walk(_dir: string, root: string, out: string[]): void {
  try {
    withFilesystem(root, "index", fs => {
      for (const entry of fs.walk(".", SKIP_DIRS)) {
        if (TEXT_EXT.has(extname(entry.name)) && entry.size <= MAX_FILE_BYTES) out.push(join(root, entry.path));
      }
    });
  } catch { /* unsupported/unsafe scope does not become embedding input */ }
}
function existsAuthorized(root: string, name: string): boolean {
  try { return withFilesystem(root, "index", fs => !fs.metadata(name).directory); } catch { return false; }
}

function chunk(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) {
    chunks.push(text.slice(i, i + CHUNK_CHARS));
  }
  return chunks.length ? chunks : [text];
}

export interface Fingerprint {
  files: number;
  languages: Record<string, number>;
  frameworks: string[];
  hasTests: boolean;
}

/** Build a quick project profile (fingerprint). */
export function fingerprint(root: string): Fingerprint {
  const files: string[] = [];
  walk(root, root, files);
  const languages: Record<string, number> = {};
  let hasTests = false;
  for (const f of files) {
    const ext = extname(f);
    languages[ext] = (languages[ext] ?? 0) + 1;
    if (/\.(test|spec)\./.test(f) || /(^|\/)tests?(\/|$)/.test(f)) hasTests = true;
  }
  const frameworks: string[] = [];
  if (existsAuthorized(root, "package.json")) {
    try {
      const j = JSON.parse(readWorkspaceText(root, "package.json", "index", MAX_FILE_BYTES));
      const deps = { ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) };
      for (const fw of ["react", "next", "vue", "svelte", "express", "bun", "zod"]) {
        if (deps[fw]) frameworks.push(fw);
      }
    } catch {}
  }
  if (existsAuthorized(root, "requirements.txt") || existsAuthorized(root, "pyproject.toml"))
    frameworks.push("python");
  if (existsAuthorized(root, "Cargo.toml")) frameworks.push("rust");
  return { files: files.length, languages, frameworks, hasTests };
}

/** Index a project into the RAG store. Returns chunk count. */
export async function indexProject(store: Store, root: string, project: string): Promise<number> {
  const files: string[] = [];
  walk(root, root, files);
  store.clearRag(project);
  let count = 0;
  for (const f of files) {
    let text: string;
    try {
      text = readWorkspaceText(root, f, "index", MAX_FILE_BYTES);
    } catch {
      continue;
    }
    const rel = relative(root, f);
    const chunks = chunk(text);
    for (let i = 0; i < chunks.length; i++) {
      const vec = await embed(`${rel}\n${chunks[i]}`);
      store.insertChunk(`ch_${randomUUID().slice(0, 8)}`, project, rel, i, chunks[i], vec);
      count++;
    }
  }
  return count;
}

export interface RetrievedChunk {
  path: string;
  text: string;
  score: number;
}

/**
 * A1 F03: persisted chunks are candidates, not authority. Each row is re-authorized
 * against the project root at retrieval time (sensitive policy + current, in-root,
 * non-escaping metadata), so a chunk indexed before a file became sensitive, moved,
 * or was deleted is never returned.
 */
function reauthorizedChunk(root: string, path: string): boolean {
  if (typeof path !== "string" || !path) return false;
  if (isSecretPath(join(root, path))) return false;
  try { return withFilesystem(root, "index", (fs) => !fs.metadata(path).directory); } catch { return false; }
}

/** Retrieve the top-k most relevant chunks for a query. */
export async function retrieve(
  store: Store,
  project: string,
  root: string,
  query: string,
  k = 5,
): Promise<RetrievedChunk[]> {
  const rows = store.allChunks(project).filter((r) => reauthorizedChunk(root, r.path));
  if (rows.length === 0) return [];
  const qvec = await embed(query);
  const scored = rows.map((r) => {
    let stored: number[] | null = null;
    if (r.embedding) {
      try {
        stored = JSON.parse(r.embedding);
      } catch {
        stored = null;
      }
    }
    // If dimensions mismatch (e.g. mixed model/fallback), fall back to lexical
    // on both sides so cosine is meaningful — never crash.
    let score: number;
    if (stored && sameSpace(stored, qvec)) {
      score = cosine(qvec, stored);
    } else {
      score = cosine(lexicalVector(query), lexicalVector(r.text));
    }
    return { path: r.path, text: r.text, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

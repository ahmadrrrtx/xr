/**
 * XR Daemon — workspace files routes (Phase G · G-1/G-2, experimental).
 *
 * A REAL, scope-enforced file browser for the project the daemon runs in
 * (process.cwd() — the same root /api/overview reports). This powers the
 * dashboard "Files & Artifacts" panel (previously a static placeholder that
 * claimed nothing existed) and the coding-workspace surface.
 *
 * Security posture:
 *   · every path is resolved against the project root and must stay inside
 *     it — traversal (.., absolute, symlink escapes) is rejected with 400;
 *   · reads are size-capped (512 KB) and text-only (null-byte sniff);
 *   · `git diff` runs through runCommand with an argv array (no shell), a
 *     timeout, and a bounded buffer; untracked files honestly return an
 *     empty diff with tracked:false.
 *
 * No capability is invented: this is filesystem + git inspection scoped to
 * the same directory the CLI already works in.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { route, type DaemonRoute } from "./router.ts";
import { getApprovalStore } from "../../control/approval-store.ts";
import { buildStructuredPreview } from "../../control/preview.ts";
import { buildHunkPatch, hunkSummary, parseUnifiedDiff } from "../hunks.ts";

const READ_LIMIT = 512 * 1024;
const WRITE_LIMIT = 1024 * 1024;
const ENTRY_CAP = 600;
const HEAVY_DIRS = new Set([".git", "node_modules", "dist", "out", "build", "target", ".venv", ".next", "__pycache__", ".cache", ".npm", ".arena", ".svelte-kit"]);

interface FileEntry {
  name: string;
  rel: string;
  type: "file" | "dir";
  size: number;
  mtime: number;
  git: "clean" | "modified" | "staged" | "untracked" | "added" | "deleted" | null;
  isText?: boolean;
}

/** Resolve a user-supplied relative path strictly inside root. Returns null on escape. */
export function insideRoot(root: string, relPath: string): string | null {
  if (isAbsolute(relPath)) return null;
  const target = resolve(root, relPath);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

async function gitSummaryFor(root: string): Promise<{ branch: string | null; dirty: boolean }> {
  try {
    const { runCommand } = await import("../../util/process.ts");
    const [branch, status] = await Promise.all([
      runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, timeoutMs: 3000 }),
      runCommand("git", ["status", "--porcelain"], { cwd: root, timeoutMs: 3000 }),
    ]);
    return {
      branch: branch.ok && branch.stdout.trim() ? branch.stdout.trim() : null,
      dirty: status.ok && status.stdout.trim().length > 0,
    };
  } catch {
    return { branch: null, dirty: false };
  }
}

/** Parse `git status --porcelain` lines into per-file status. */
function porcelainStatus(output: string): Map<string, "modified" | "staged" | "untracked" | "added" | "deleted"> {
  const map = new Map<string, "modified" | "staged" | "untracked" | "added" | "deleted">();
  for (const line of output.split("\n")) {
    if (!line) continue;
    const xy = line.slice(0, 2);
    const p = line.slice(3).trim();
    if (!p) continue;
    const rel = p.replace(/\s*->.*$/, ""); // renames: "a -> b" → keep target? keep first
    if (xy === "??") map.set(rel, "untracked");
    else if (xy.includes("A")) map.set(rel, "added");
    else if (xy.includes("D")) map.set(rel, "deleted");
    else if (xy[1] === "M" || xy[1] === "T") map.set(rel, "modified");
    else if (xy[0] === "M" || xy[0] === "T") map.set(rel, "staged");
  }
  return map;
}

function looksText(name: string, head: Buffer): boolean {
  if (head.length === 0) return true;
  if (head.includes(0)) return false;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const binaryExt = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "woff", "woff2", "ttf", "eot", "wasm", "sqlite", "db", "class", "jar", "exe", "dll", "so", "dylib", "pyc"]);
  if (binaryExt.has(ext)) return false;
  return true;
}

export function filesRoutes(): DaemonRoute[] {
  return [
    route({
      id: "files.list",
      path: "/api/files",
      method: "GET",
      handle: async ({ json, url }) => {
        try {
          const root = resolve(process.cwd());
          const rel = url.searchParams.get("path") ?? "";
          const target = insideRoot(root, rel);
          if (!target) return json({ error: "path escapes the project root" }, 400);
          const st = statSync(target);
          if (!st.isDirectory()) return json({ error: "not a directory" }, 400);

          let names: string[];
          try {
            names = readdirSync(target);
          } catch {
            return json({ error: "cannot read directory" }, 403);
          }
          const git = await gitSummaryFor(root);
          let porcelain = new Map<string, never>();
          if (git.dirty) {
            try {
              const { runCommand } = await import("../../util/process.ts");
              const res = await runCommand("git", ["status", "--porcelain"], { cwd: root, timeoutMs: 5000 });
              if (res.ok) porcelain = porcelainStatus(res.stdout) as Map<string, never>;
            } catch {
              // git status is best-effort; entries just lose their git badge
            }
          }

          const entries: FileEntry[] = [];
          let truncated = false;
          for (const name of names) {
            if (name === ".git") continue;
            if (entries.length >= ENTRY_CAP) { truncated = true; break; }
            const abs = join(target, name);
            let isDir = false, size = 0, mtime = 0;
            try {
              const s = statSync(abs);
              isDir = s.isDirectory();
              size = s.size;
              mtime = s.mtimeMs;
            } catch {
              continue; // broken symlink / unreadable — skip honestly
            }
            const relPath = rel ? `${rel}/${name}` : name;
            const gitState = porcelain.get(relPath) ?? porcelain.get(name) ?? null;
            entries.push({
              name,
              rel: relPath,
              type: isDir ? "dir" : "file",
              size,
              mtime,
              git: gitState as FileEntry["git"],
              isText: isDir ? undefined : looksText(name, Buffer.alloc(0)),
            });
          }
          entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));

          return json({
            root,
            cwd: rel,
            entries,
            git,
            truncated,
          });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "files.read",
      path: "/api/files/read",
      method: "GET",
      handle: async ({ json, url }) => {
        try {
          const root = resolve(process.cwd());
          const rel = url.searchParams.get("path") ?? "";
          const target = insideRoot(root, rel);
          if (!target) return json({ error: "path escapes the project root" }, 400);
          const st = statSync(target);
          if (!st.isFile()) return json({ error: "not a file" }, 400);
          if (st.size > READ_LIMIT * 4) return json({ error: "file is too large to preview" }, 413);

          const buf = readFileSync(target);
          const isText = looksText(basename(target), buf.subarray(0, 4096));
          if (!isText) return json({ error: "binary file — preview is text-only" }, 415);
          const truncated = buf.length > READ_LIMIT;
          const content = buf.subarray(0, READ_LIMIT).toString("utf8");
          return json({ path: rel, content, size: st.size, truncated, isText, mtimeMs: st.mtimeMs });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "files.diff",
      path: "/api/files/diff",
      method: "GET",
      handle: async ({ json, url }) => {
        try {
          const root = resolve(process.cwd());
          const rel = url.searchParams.get("path") ?? "";
          const target = insideRoot(root, rel);
          if (!target) return json({ error: "path escapes the project root" }, 400);
          const st = statSync(target);
          if (!st.isFile()) return json({ error: "not a file" }, 400);

          const { runCommand } = await import("../../util/process.ts");
          const res = await runCommand("git", ["diff", "--", rel], { cwd: root, timeoutMs: 10_000, maxBuffer: 2 * 1024 * 1024 });
          const diff = res.ok ? res.stdout : "";
          // Untracked files have no diff: detect via ls-files
          const trackedRes = await runCommand("git", ["ls-files", "--error-unmatch", rel], { cwd: root, timeoutMs: 5000 });
          const tracked = trackedRes.ok;
          // Phase 2 · G-06: the same diff, addressed hunk by hunk (stable ids).
          const hunks = parseUnifiedDiff(diff).hunks.map(hunkSummary);
          return json({ path: rel, diff, ok: res.ok, tracked, hunks });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "files.hunks.revert",
      path: "/api/files/hunks/revert",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        // Phase 2 · G-06 — hunk-level REJECT over the engine's own diff.
        // "Keep this change, throw that one away" without a whole-file
        // rewrite: the chosen hunks are reverse-applied by git itself
        // (`git apply -R` of a subset patch), after ONE human approval whose
        // preview shows exactly those hunks. Accept is a no-op by design
        // (the working tree already has the change); staging is git.stage.
        try {
          const root = resolve(process.cwd());
          const body = (await req.json().catch(() => ({}))) as { path?: string; hunkIds?: unknown; baseMtimeMs?: number };
          const rel = typeof body?.path === "string" ? body.path : "";
          const ids = Array.isArray(body?.hunkIds) ? body.hunkIds.filter((x): x is string => typeof x === "string") : [];
          if (!rel || ids.length === 0) return json({ error: "expected { path, hunkIds: string[] }" }, 400);
          const target = insideRoot(root, rel);
          if (!target) return json({ error: "path escapes the project root" }, 400);
          let st;
          try {
            st = statSync(target);
          } catch {
            return json({ error: "no such file" }, 404);
          }
          if (!st.isFile()) return json({ error: "not a file" }, 400);
          if (typeof body.baseMtimeMs === "number" && Math.abs(st.mtimeMs - body.baseMtimeMs) > 2) {
            return json({ error: "file changed on disk since it was loaded", stale: true, mtimeMs: st.mtimeMs }, 409);
          }

          const { runCommand } = await import("../../util/process.ts");
          const current = await runCommand("git", ["diff", "--", rel], { cwd: root, timeoutMs: 10_000, maxBuffer: 2 * 1024 * 1024 });
          if (!current.ok) return json({ error: `git diff failed: ${current.stderr.trim() || "not a git repository?"}` }, 400);
          const parsed = parseUnifiedDiff(current.stdout);
          const byId = new Map(parsed.hunks.map((h) => [h.id, h] as const));
          const missing = ids.filter((id) => !byId.has(id));
          if (missing.length) {
            // A stale id means the file changed under the reviewer — refuse, never guess.
            return json({ error: "hunk no longer present (the file changed since the diff was loaded)", missing, hunks: parsed.hunks.map(hunkSummary) }, 409);
          }
          const selected = [...new Set(ids)].map((id) => byId.get(id)!);
          const patch = buildHunkPatch(parsed, selected);
          const added = selected.reduce((n, h) => n + h.added, 0);
          const removed = selected.reduce((n, h) => n + h.removed, 0);

          const approvalsCfg = config?.approvals;
          const approvalStore = getApprovalStore(state.store, {
            defaultTtlMs: approvalsCfg?.defaultTtlMs,
            perSurface: approvalsCfg?.perSurface,
          });
          const reason = `revert ${selected.length} of ${parsed.hunks.length} hunk${parsed.hunks.length === 1 ? "" : "s"} in ${rel} (undo +${added}/−${removed} lines) — desktop editor hunk review`;
          const handle = approvalStore.request({
            tool: "patch",
            args: { path: rel, patch, reverse: true, hunkIds: selected.map((h) => h.id) },
            reason,
            preview: buildStructuredPreview({ tool: "patch", args: { path: rel, patch, reverse: true }, reason, cwd: root, riskTier: "medium" }),
            riskTier: "medium",
            surface: "daemon-files",
          });
          state.store.audit("files.hunks.requested", { path: rel, hunkIds: selected.map((h) => h.id), approvalId: handle.id });
          const outcome = await handle.outcome;
          if (!outcome.approved) {
            state.store.audit("files.hunks.denied", { path: rel, decision: outcome.decision });
            return json({ applied: false, approvalId: handle.id, decision: outcome.decision });
          }

          // Re-check right before applying: the reviewer approved THESE bytes.
          const st2 = statSync(target);
          if (Math.abs(st2.mtimeMs - st.mtimeMs) > 2) {
            state.store.audit("files.hunks.stale", { path: rel });
            return json({ applied: false, approvalId: handle.id, error: "file changed on disk while the approval was pending", stale: true, mtimeMs: st2.mtimeMs }, 409);
          }
          const scratch = mkdtempSync(join(tmpdir(), "xr-hunk-"));
          try {
            const patchPath = join(scratch, "revert.patch");
            writeFileSync(patchPath, patch, "utf8");
            const applied = await runCommand("git", ["apply", "-R", "--whitespace=nowarn", patchPath], { cwd: root, timeoutMs: 10_000 });
            if (!applied.ok) {
              state.store.audit("files.hunks.error", { path: rel, error: applied.stderr.trim() });
              return json({ applied: false, approvalId: handle.id, error: `git apply -R failed: ${applied.stderr.trim()}` }, 409);
            }
          } finally {
            rmSync(scratch, { recursive: true, force: true });
          }
          const after = await runCommand("git", ["diff", "--", rel], { cwd: root, timeoutMs: 10_000, maxBuffer: 2 * 1024 * 1024 });
          const remaining = parseUnifiedDiff(after.ok ? after.stdout : "").hunks.map(hunkSummary);
          const st3 = statSync(target);
          state.store.audit("files.hunks.reverted", { path: rel, hunkIds: selected.map((h) => h.id), added, removed, remaining: remaining.length });
          return json({ applied: true, approvalId: handle.id, path: rel, reverted: selected.length, added, removed, mtimeMs: st3.mtimeMs, hunks: remaining, diff: after.ok ? after.stdout : "" });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "files.write",
      path: "/api/files/write",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        try {
          const root = resolve(process.cwd());
          const body = (await req.json().catch(() => ({}))) as {
            path?: string;
            content?: string;
            baseMtimeMs?: number;
          };
          const rel = typeof body?.path === "string" ? body.path : "";
          if (!rel) return json({ error: "expected { path, content }" }, 400);
          if (typeof body.content !== "string") return json({ error: "content must be a string" }, 400);
          const target = insideRoot(root, rel);
          if (!target) return json({ error: "path escapes the project root" }, 400);
          const bytes = Buffer.byteLength(body.content, "utf8");
          if (bytes > WRITE_LIMIT) return json({ error: "content exceeds the 1 MB write limit" }, 413);

          // Staleness guard (honest concurrency): if the caller declares the
          // mtime it loaded and disk moved on since, refuse BEFORE raising an
          // approval — a human must never approve a blind clobber.
          let existed = false;
          try {
            const st = statSync(target);
            if (st.isDirectory()) return json({ error: "path is a directory" }, 400);
            existed = true;
            if (typeof body.baseMtimeMs === "number" && Math.abs(st.mtimeMs - body.baseMtimeMs) > 2) {
              return json({ error: "file changed on disk since it was loaded", stale: true, mtimeMs: st.mtimeMs }, 409);
            }
          } catch {
            /* absent — created on approval */
          }

          // ── Phase 2B · approval gate (D-01): a save NEVER touches disk without
          // an explicit human decision through the durable, cross-process
          // approval store — same consent plane as the write_file tool ──
          const approvalsCfg = config?.approvals;
          const approvalStore = getApprovalStore(state.store, {
            defaultTtlMs: approvalsCfg?.defaultTtlMs,
            perSurface: approvalsCfg?.perSurface,
          });
          const reason = `${existed ? "overwrite" : "create"} ${rel} (${bytes} bytes) — desktop editor save`;
          const handle = approvalStore.request({
            tool: "write_file",
            args: { path: rel, content: body.content },
            reason,
            preview: buildStructuredPreview({ tool: "write_file", args: { path: rel, content: body.content }, reason, cwd: root, riskTier: "medium" }),
            riskTier: "medium",
            surface: "daemon-files",
          });
          const outcome = await handle.outcome;
          if (!outcome.approved) {
            state.store.audit("files.write.denied", { path: rel, decision: outcome.decision });
            return json({ applied: false, approvalId: handle.id, decision: outcome.decision });
          }
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, body.content, "utf8");
          const st = statSync(target);
          state.store.audit("files.write.applied", { path: rel, bytes, mtimeMs: st.mtimeMs });
          return json({ applied: true, approvalId: handle.id, path: rel, bytes, mtimeMs: st.mtimeMs });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}

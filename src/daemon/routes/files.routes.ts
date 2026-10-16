/** Workspace HTTP operations share the tool filesystem authority. Authentication stays in server.ts. */
import { isAbsolute, resolve, sep } from "node:path";
import { route, type DaemonRoute } from "./router.ts";
import { getApprovalStore } from "../../control/approval-store.ts";
import { buildStructuredPreview } from "../../control/preview.ts";
import { FilesystemAuthority, FilesystemError, filesystemMessage, type PreparedFileOperation } from "../../security/filesystem.ts";
import { buildHunkPatch, hunkSummary, parseUnifiedDiff } from "../hunks.ts";
import { fileGit, reverseHunks, snapshotDiff } from "../file-snapshots.ts";
const READ_LIMIT = 512 * 1024, WRITE_LIMIT = 1024 * 1024, ENTRY_CAP = 600;
/** Lexical compatibility helper for legacy callers. NOT an I/O authorization. */
export function insideRoot(root: string, relPath: string): string | null {
  if (isAbsolute(relPath)) return null;
  const target = resolve(root, relPath);
  return target === root || target.startsWith(root + sep) ? target : null;
}
function looksText(name: string): boolean { return !/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|eot|wasm|sqlite|db|class|jar|exe|dll|so|dylib|pyc)$/i.test(name); }
const statusFor = (e: unknown) => e instanceof FilesystemError && e.code === "stale" ? 409 : e instanceof FilesystemError && e.code === "limit" ? 413 : e instanceof FilesystemError && e.code === "binary" ? 415 : e instanceof FilesystemError && e.code === "missing" ? 404 : 400;
export function filesRoutes(): DaemonRoute[] {
  return [
    route({ id: "files.list", path: "/api/files", method: "GET", handle: async ({ json, url }) => {
      let fs: FilesystemAuthority | undefined;
      try {
        fs = new FilesystemAuthority(process.cwd(), "daemon");
        const rel = url.searchParams.get("path") ?? ".";
        if (isAbsolute(rel)) throw new FilesystemError();
        const entries = fs.list(rel || ".", ENTRY_CAP + 1).filter(e => e.name !== ".git");
        const branch = fileGit(fs.root, ["rev-parse", "--abbrev-ref", "HEAD"]);
        const status = fileGit(fs.root, ["status", "--porcelain"]);
        return json({ root: fs.root, cwd: rel === "." ? "" : rel,
          entries: entries.slice(0, ENTRY_CAP).map(e => ({ name: e.name, rel: e.path, type: e.directory ? "dir" : "file", size: e.size, mtime: e.mtimeMs, git: null, isText: e.directory ? undefined : looksText(e.name) })),
          git: { branch: branch.ok ? branch.stdout.trim() || null : null, dirty: status.ok && !!status.stdout.trim() }, truncated: entries.length > ENTRY_CAP });
      } catch (e) { return json({ error: filesystemMessage(e) }, statusFor(e)); }
      finally { fs?.close(); }
    } }),
    route({ id: "files.read", path: "/api/files/read", method: "GET", handle: async ({ json, url }) => {
      let fs: FilesystemAuthority | undefined;
      try {
        fs = new FilesystemAuthority(process.cwd(), "daemon");
        const rel = url.searchParams.get("path") ?? "";
        if (isAbsolute(rel)) throw new FilesystemError();
        if (!looksText(rel)) return json({ error: "binary file — preview is text-only" }, 415);
        const snapshot = fs.read(rel, READ_LIMIT * 4);
        return json({ path: rel, content: snapshot.bytes.subarray(0, READ_LIMIT).toString("utf8"), size: snapshot.size, truncated: snapshot.size > READ_LIMIT, isText: true, mtimeMs: snapshot.mtimeMs });
      } catch (e) { return json({ error: filesystemMessage(e) }, statusFor(e)); }
      finally { fs?.close(); }
    } }),
    route({ id: "files.diff", path: "/api/files/diff", method: "GET", handle: async ({ json, url }) => {
      let fs: FilesystemAuthority | undefined;
      try {
        fs = new FilesystemAuthority(process.cwd(), "daemon");
        const rel = url.searchParams.get("path") ?? "";
        if (isAbsolute(rel)) throw new FilesystemError();
        const snapshot = fs.read(rel);
        const diff = snapshotDiff(fs.root, snapshot.path, snapshot.content);
        return json({ path: rel, ...diff, hunks: parseUnifiedDiff(diff.diff).hunks.map(hunkSummary) });
      } catch (e) { return json({ error: filesystemMessage(e) }, statusFor(e)); }
      finally { fs?.close(); }
    } }),
    route({ id: "files.hunks.revert", path: "/api/files/hunks/revert", method: "POST", handle: async ({ req, json, state, config }) => {
      let fs: FilesystemAuthority | undefined, pending: PreparedFileOperation | undefined;
      try {
        const body = await req.json() as { path?: string; hunkIds?: unknown; baseMtimeMs?: number };
        if (typeof body.path !== "string" || isAbsolute(body.path) || !Array.isArray(body.hunkIds) || !body.hunkIds.length || body.hunkIds.some(id => typeof id !== "string")) return json({ error: "expected { path, hunkIds: string[] }" }, 400);
        fs = new FilesystemAuthority(process.cwd(), "daemon");
        // A diff/revert discloses old content: write permission alone cannot authorize it.
        fs.read(body.path);
        pending = fs.prepare(body.path, "write");
        if (typeof body.baseMtimeMs === "number" && Math.abs((pending.mtimeMs ?? 0) - body.baseMtimeMs) > 2) throw new FilesystemError("stale");
        const current = snapshotDiff(fs.root, pending.path, pending.oldContent), parsed = parseUnifiedDiff(current.diff);
        const ids = body.hunkIds as string[], byId = new Map(parsed.hunks.map(h => [h.id, h]));
        const missing = ids.filter(id => !byId.has(id));
        if (missing.length) return json({ error: "hunk no longer present (the file changed since the diff was loaded)", missing, hunks: parsed.hunks.map(hunkSummary) }, 409);
        const selected = [...new Set(ids)].map(id => byId.get(id)!);
        const patch = buildHunkPatch(parsed, selected), content = reverseHunks(pending.oldContent, selected);
        const args = { path: pending.path, patch, reverse: true, hunkIds: ids, filesystem: pending.identity };
        const reason = `revert ${selected.length} of ${parsed.hunks.length} hunks in ${pending.path} — desktop editor hunk review`;
        const store = getApprovalStore(state.store, { defaultTtlMs: config?.approvals?.defaultTtlMs, perSurface: config?.approvals?.perSurface });
        const handle = store.request({ tool: "patch", args, reason, riskTier: "medium", surface: "daemon-files", preview: buildStructuredPreview({ tool: "patch", args, reason, cwd: fs.root, riskTier: "medium", preparedPreview: patch }) });
        state.store.audit("files.hunks.requested", { path: pending.path, approvalId: handle.id, hunkIds: ids });
        const outcome = await handle.outcome;
        if (!outcome.approved) { state.store.audit("files.hunks.denied", { path: pending.path, decision: outcome.decision }); return json({ applied: false, approvalId: handle.id, decision: outcome.decision }); }
        pending.commit(content);
        const after = snapshotDiff(fs.root, pending.path, content), remaining = parseUnifiedDiff(after.diff).hunks.map(hunkSummary);
        const added = selected.reduce((n, h) => n + h.added, 0), removed = selected.reduce((n, h) => n + h.removed, 0);
        const mtimeMs = fs.metadata(pending.path).mtimeMs;
        state.store.audit("files.hunks.reverted", { path: pending.path, hunkIds: ids, added, removed, remaining: remaining.length });
        return json({ applied: true, approvalId: handle.id, path: pending.path, reverted: selected.length, added, removed, mtimeMs, hunks: remaining, diff: after.diff });
      } catch (e) { return json({ error: filesystemMessage(e), stale: e instanceof FilesystemError && e.code === "stale" }, statusFor(e)); }
      finally { pending?.close(); fs?.close(); }
    } }),
    route({ id: "files.write", path: "/api/files/write", method: "POST", handle: async ({ req, json, state, config }) => {
      let fs: FilesystemAuthority | undefined, pending: PreparedFileOperation | undefined;
      try {
        const body = await req.json() as { path?: string; content?: string; baseMtimeMs?: number };
        if (typeof body.path !== "string" || !body.path || isAbsolute(body.path) || typeof body.content !== "string") return json({ error: "expected { path, content }" }, 400);
        const bytes = Buffer.byteLength(body.content);
        if (bytes > WRITE_LIMIT) return json({ error: "content exceeds the 1 MB write limit" }, 413);
        fs = new FilesystemAuthority(process.cwd(), "daemon");
        pending = fs.prepare(body.path, "write", WRITE_LIMIT);
        if (typeof body.baseMtimeMs === "number" && Math.abs((pending.mtimeMs ?? 0) - body.baseMtimeMs) > 2) throw new FilesystemError("stale");
        const args = { path: pending.path, content: body.content, filesystem: pending.identity };
        const reason = `${pending.existed ? "overwrite" : "create"} ${pending.path} (${bytes} bytes) — desktop editor save`;
        const store = getApprovalStore(state.store, { defaultTtlMs: config?.approvals?.defaultTtlMs, perSurface: config?.approvals?.perSurface });
        const handle = store.request({ tool: "write_file", args, reason, riskTier: "medium", surface: "daemon-files", preview: buildStructuredPreview({ tool: "write_file", args, reason, cwd: fs.root, riskTier: "medium" }) });
        const outcome = await handle.outcome;
        if (!outcome.approved) { state.store.audit("files.write.denied", { path: pending.path, decision: outcome.decision }); return json({ applied: false, approvalId: handle.id, decision: outcome.decision }); }
        pending.commit(body.content);
        const mtimeMs = fs.metadata(pending.path).mtimeMs;
        state.store.audit("files.write.applied", { path: pending.path, bytes, mtimeMs });
        return json({ applied: true, approvalId: handle.id, path: pending.path, bytes, mtimeMs });
      } catch (e) { return json({ error: filesystemMessage(e), stale: e instanceof FilesystemError && e.code === "stale" }, statusFor(e)); }
      finally { pending?.close(); fs?.close(); }
    } }),
  ];
}

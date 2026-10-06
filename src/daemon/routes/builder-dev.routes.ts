/**
 * Phase 17 · Builder — diff application, undo, dev server, live events.
 *
 *   POST /api/builder/projects/{id}/apply-diff   SSE · patch (dry-run first; conflicts → 409 before anyone is asked)
 *   POST /api/builder/projects/{id}/undo         SSE · write_file (restore the backup the apply made)
 *   GET  /api/builder/projects/{id}/dev-server   detection + status + log tail
 *   POST /api/builder/projects/{id}/dev-server/start    SSE · shell (policy gate → approval → spawn)
 *   POST /api/builder/projects/{id}/dev-server/stop     JSON
 *   POST /api/builder/projects/{id}/dev-server/install  SSE · shell (`<pm> install`, streamed)
 *   GET  /api/builder/projects/{id}/events       SSE · dev-server:* + fs:changed
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, sep } from "node:path";
import { route, type DaemonRoute } from "./router.ts";
import { insideRoot } from "./files.routes.ts";
import { checkAction } from "../../security/guard.ts";
import { getBuilderProjects, nextBackupPath, resolveBackup, type BuilderProject } from "../builder-projects.ts";
import { applyUnifiedDiff, describeConflicts, normalisePatch } from "../builder-patch.ts";
import { parseUnifiedDiff, buildHunkPatch } from "../hunks.ts";
import { detectDevServer, getDevServers, realDetectFs, type DevServerEvent } from "../dev-servers.ts";
import { gatedMutation, projectFrom, projectPattern, sseResponse } from "./builder-shared.ts";

const PATCH_LIMIT = 512 * 1024;
const READ_LIMIT = 512 * 1024;

function cleanRel(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const rel = input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!rel || rel.length > 2_000) return null;
  return rel;
}

function targetOf(project: BuilderProject, rel: string): string | null {
  return insideRoot(project.root, rel.split("/").join(sep));
}

export function builderDevRoutes(): DaemonRoute[] {
  return [
    route({
      id: "builder.applyDiff",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("apply-diff"),
      method: "POST",
      handle: async ({ req, json, path, state, config }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const body = (await req.json().catch(() => ({}))) as { path?: string; patch?: string; hunks?: number[]; baseMtimeMs?: number };
        const rel = cleanRel(body.path);
        if (!rel || typeof body.patch !== "string") return json({ error: "expected { path, patch }" }, 400);
        if (body.patch.length > PATCH_LIMIT) return json({ error: "patch exceeds the 512 KB limit" }, 413);
        const target = targetOf(project, rel);
        if (!target) return json({ error: "path escapes the project root" }, 400);
        const selected = Array.isArray(body.hunks) ? body.hunks.filter((n) => Number.isInteger(n) && n >= 0) : undefined;

        let current = "";
        let existed = false;
        try {
          const st = statSync(target);
          if (st.isDirectory()) return json({ error: "path is a directory" }, 400);
          if (st.size > READ_LIMIT) return json({ error: "file too large to patch here (512 KB cap)" }, 413);
          if (typeof body.baseMtimeMs === "number" && Math.abs(st.mtimeMs - body.baseMtimeMs) > 2) {
            return json({ error: "file changed on disk since it was loaded", stale: true, mtimeMs: st.mtimeMs }, 409);
          }
          current = readFileSync(target, "utf8");
          existed = true;
        } catch {
          /* new file: the patch must be all additions */
        }

        // Dry run BEFORE consent: a human never approves a patch that cannot land.
        const result = applyUnifiedDiff(current, body.patch, selected);
        if (!result.ok) {
          state.store.audit("builder.applyDiff.conflict", { project: project.id, path: rel, conflicts: result.conflicts.length });
          return json({ error: `Couldn't apply cleanly — ${describeConflicts(result.conflicts)}`, conflict: true, conflicts: result.conflicts }, 409);
        }
        const parsed = parseUnifiedDiff(normalisePatch(body.patch));
        const chosen = parsed.hunks.filter((h) => result.applied.includes(h.index));
        const patchText = buildHunkPatch(parsed, chosen);
        const added = chosen.reduce((n, h) => n + h.added, 0);
        const removed = chosen.reduce((n, h) => n + h.removed, 0);
        const next = result.content;
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: "patch",
          args: { path: rel, hunks: chosen.length, added, removed, fuzzy: result.fuzzy },
          previewArgs: { patch: patchText },
          reason: `Apply ${chosen.length} hunk${chosen.length === 1 ? "" : "s"} to ${rel} (+${added} −${removed}) — Builder`,
          riskTier: "medium",
          audit: "builder.applyDiff",
          perform: () => {
            let backupId: string | null = null;
            if (existed) {
              const b = nextBackupPath(project.id, rel);
              copyFileSync(target, b.path);
              backupId = b.backupId;
            }
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, next, "utf8");
            const st = statSync(target);
            return { path: rel, content: next, mtimeMs: st.mtimeMs, backupId, applied: result.applied, skipped: result.skipped, fuzzy: result.fuzzy };
          },
        });
      },
    }),
    route({
      id: "builder.undo",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("undo"),
      method: "POST",
      handle: async ({ req, json, path, state, config }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const body = (await req.json().catch(() => ({}))) as { path?: string; backupId?: string };
        const rel = cleanRel(body.path);
        if (!rel || typeof body.backupId !== "string") return json({ error: "expected { path, backupId }" }, 400);
        const target = targetOf(project, rel);
        if (!target) return json({ error: "path escapes the project root" }, 400);
        const backup = resolveBackup(project.id, body.backupId);
        if (!backup) return json({ error: "backup not found (undo is one level deep and does not survive a restart)" }, 404);
        const content = readFileSync(backup, "utf8");
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: "write_file",
          args: { path: rel, bytes: Buffer.byteLength(content, "utf8"), undo: true },
          previewArgs: { content },
          reason: `Undo the last applied diff on ${rel} — Builder`,
          riskTier: "medium",
          audit: "builder.undo",
          perform: () => {
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, content, "utf8");
            const st = statSync(target);
            return { path: rel, content, mtimeMs: st.mtimeMs };
          },
        });
      },
    }),
    route({
      id: "builder.devServer.status",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("dev-server"),
      method: "GET",
      handle: async ({ json, path }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const detected = detectDevServer(realDetectFs(project.root));
        const servers = getDevServers();
        return json({ detected, status: servers.status(project.id), log: servers.logTail(project.id) });
      },
    }),
    route({
      id: "builder.devServer.start",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("dev-server/start"),
      method: "POST",
      handle: async ({ req, json, path, state, config }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const body = (await req.json().catch(() => ({}))) as { cmd?: string };
        let detected = detectDevServer(realDetectFs(project.root));
        if (typeof body.cmd === "string" && body.cmd.trim()) {
          // A hand-typed command: same deterministic policy gate as the terminal.
          const cmd = body.cmd.trim().slice(0, 2_000);
          const decision = checkAction({ tool: "shell", args: { cmd } }, { egressAllowlist: [], requireApproval: ["shell"] });
          if (!decision.allowed) {
            state.store.audit("builder.devServer.blocked", { project: project.id, cmd, reason: decision.reason });
            return json({ error: `blocked: ${decision.reason}`, blocked: true }, 403);
          }
          const argv = cmd.split(/\s+/).filter(Boolean);
          detected = { ...detected, kind: detected.kind === "static" ? "node" : detected.kind, argv, cmd, label: cmd, needsInstall: false };
        }
        if (detected.kind === "none") return json({ error: detected.hint, detected }, 400);
        const servers = getDevServers();
        const cur = servers.status(project.id);
        if (cur && (cur.state === "running" || cur.state === "starting")) return json({ error: "dev server already running", status: cur }, 409);
        if (detected.needsInstall) return json({ error: "dependencies are not installed", needsInstall: true, detected }, 409);
        if (detected.kind !== "static" && detected.cmd) {
          const decision = checkAction({ tool: "shell", args: { cmd: detected.cmd } }, { egressAllowlist: [], requireApproval: ["shell"] });
          if (!decision.allowed) {
            state.store.audit("builder.devServer.blocked", { project: project.id, cmd: detected.cmd, reason: decision.reason });
            return json({ error: `blocked: ${decision.reason}`, blocked: true }, 403);
          }
        }
        const isStatic = detected.kind === "static";
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: isStatic ? "serve_static" : "shell",
          args: isStatic ? { path: ".", kind: "static" } : { cmd: detected.cmd, kind: detected.kind, cwd: project.root },
          reason: isStatic ? `Serve ${project.name} on a local port (read-only static server) — Builder preview` : `Start the ${detected.label} dev server in ${project.name} — Builder preview`,
          riskTier: isStatic ? "low" : "high",
          audit: "builder.devServer.start",
          perform: async () => {
            const status = await servers.start(project.id, project.root, detected);
            return { status, detected };
          },
        });
      },
    }),
    route({
      id: "builder.devServer.stop",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("dev-server/stop"),
      method: "POST",
      handle: async ({ json, path, state }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const stopped = await getDevServers().stop(project.id);
        state.store.audit("builder.devServer.stop", { project: project.id, stopped });
        return json({ stopped, status: getDevServers().status(project.id) });
      },
    }),
    route({
      id: "builder.devServer.install",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("dev-server/install"),
      method: "POST",
      handle: async ({ json, path, state, config }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        const detected = detectDevServer(realDetectFs(project.root));
        if (!detected.installArgv) return json({ error: "nothing to install for this project" }, 400);
        const cmd = detected.installArgv.join(" ");
        const decision = checkAction({ tool: "shell", args: { cmd } }, { egressAllowlist: [], requireApproval: ["shell"] });
        if (!decision.allowed) return json({ error: `blocked: ${decision.reason}`, blocked: true }, 403);
        const argv = detected.installArgv;
        return gatedMutation({
          ctx: { state, config },
          project,
          tool: "shell",
          args: { cmd, kind: "install", cwd: project.root },
          reason: `Install dependencies (${cmd}) in ${project.name} — Builder`,
          riskTier: "high",
          audit: "builder.devServer.install",
          perform: async () => {
            const code = await getDevServers().install(project.id, project.root, argv);
            return { code, ok: code === 0, needsInstall: !existsSync(`${project.root}${sep}node_modules`) };
          },
        });
      },
    }),
    route({
      id: "builder.events",
      prefix: "/api/builder/projects/",
      pattern: projectPattern("events"),
      method: "GET",
      handle: async ({ json, path, req }) => {
        const project = projectFrom(path);
        if (!project) return json({ error: "unknown project — open it first" }, 404);
        return sseResponse(
          (send, signal) =>
            new Promise<void>((resolve) => {
              const servers = getDevServers();
              const offServer = servers.subscribe(project.id, project.root, (e: DevServerEvent) => send(e));
              let offFs: (() => void) | null = null;
              try {
                offFs = getBuilderProjects().subscribe(project.id, (paths) => send({ type: "fs:changed", projectId: project.id, paths }));
              } catch {
                offFs = null;
              }
              send({ type: "hello", projectId: project.id, watching: getBuilderProjects().watching(project.id), status: servers.status(project.id) });
              const heartbeat = setInterval(() => send({ type: "ping", ts: Date.now() }), 25_000);
              const done = () => {
                clearInterval(heartbeat);
                offServer();
                offFs?.();
                resolve();
              };
              const abort = req.signal;
              if (signal.aborted || abort.aborted) done();
              else {
                signal.addEventListener("abort", done, { once: true });
                abort.addEventListener("abort", done, { once: true });
              }
            }),
        );
      },
    }),
  ];
}

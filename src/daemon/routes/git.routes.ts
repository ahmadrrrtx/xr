/**
 * XR Daemon — workspace Git routes (Phase 2).
 *
 *   · read verbs (status/log) are plain argv-array `git` calls scoped to the
 *     daemon's project root — no shell, bounded output;
 *   · write verbs (stage/commit) ride the SAME durable cross-process approval
 *     store as files.write — history-mutating commands never run without an
 *     explicit human decision (riskTier medium/high, audited either way);
 *   · every path argument is validated against the project root first.
 */

import { resolve } from "node:path";
import { route, type DaemonRoute } from "./router.ts";
import { insideRoot } from "./files.routes.ts";
import { getApprovalStore } from "../../control/approval-store.ts";
import { buildStructuredPreview } from "../../control/preview.ts";

const LOG_LIMIT_MAX = 100;

interface GitStatusEntry { code: string; path: string }

function parsePorcelain(out: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const line of out.split("\n")) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (!path) continue;
    // rename entries carry " -> target"; report the target path only
    entries.push({ code, path: path.split(" -> ").pop() ?? path });
  }
  return entries;
}

export function gitRoutes(): DaemonRoute[] {
  return [
    route({
      id: "git.status",
      path: "/api/git/status",
      method: "GET",
      handle: async ({ json }) => {
        const root = resolve(process.cwd());
        const { runCommand } = await import("../../util/process.ts");
        const [branchRes, statusRes] = await Promise.all([
          runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, timeoutMs: 3000 }),
          runCommand("git", ["status", "--porcelain"], { cwd: root, timeoutMs: 5000, maxBuffer: 2 * 1024 * 1024 }),
        ]);
        if (!branchRes.ok && !statusRes.ok) {
          return json({ ok: false, repo: false, branch: null, entries: [], error: "not a git repository (or git unavailable)" });
        }
        return json({
          ok: true,
          repo: true,
          branch: branchRes.ok ? branchRes.stdout.trim() : null,
          entries: statusRes.ok ? parsePorcelain(statusRes.stdout) : [],
        });
      },
    }),
    route({
      id: "git.log",
      path: "/api/git/log",
      method: "GET",
      handle: async ({ json, url }) => {
        const root = resolve(process.cwd());
        const limit = Math.min(LOG_LIMIT_MAX, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
        const { runCommand } = await import("../../util/process.ts");
        const res = await runCommand(
          "git",
          ["log", "--pretty=%h|%ad|%an|%s", "--date=short", "-n", String(limit)],
          { cwd: root, timeoutMs: 5000, maxBuffer: 2 * 1024 * 1024 },
        );
        if (!res.ok) return json({ ok: false, commits: [], error: res.stderr.slice(0, 200) });
        const commits = res.stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash, date, author, ...rest] = line.split("|");
            return { hash, date, author, subject: rest.join("|") };
          });
        return json({ ok: true, commits });
      },
    }),
    route({
      id: "git.stage",
      path: "/api/git/stage",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        const root = resolve(process.cwd());
        const body = (await req.json().catch(() => ({}))) as { paths?: string[] | string };
        const raw = Array.isArray(body.paths) ? body.paths : typeof body.paths === "string" ? [body.paths] : [];
        if (raw.length === 0) return json({ error: "expected { paths: string[] }" }, 400);
        if (raw.length > 50) return json({ error: "too many paths (max 50)" }, 400);
        const rels: string[] = [];
        for (const p of raw) {
          if (typeof p !== "string" || !p) return json({ error: "paths must be non-empty strings" }, 400);
          if (!insideRoot(root, p)) return json({ error: `path escapes the project root: ${p}` }, 400);
          rels.push(p);
        }

        const approvalsCfg = config?.approvals;
        const approvalStore = getApprovalStore(state.store, {
          defaultTtlMs: approvalsCfg?.defaultTtlMs,
          perSurface: approvalsCfg?.perSurface,
        });
        const args = { paths: rels };
        const handle = approvalStore.request({
          tool: "git_stage",
          args,
          reason: `stage ${rels.length} path(s) in the project workspace`,
          preview: buildStructuredPreview({ tool: "git_stage", args, reason: `git add -- ${rels.join(" ")}`, cwd: root, riskTier: "medium" }),
          riskTier: "medium",
          surface: "daemon-git",
        });
        const outcome = await handle.outcome;
        if (!outcome.approved) {
          state.store.audit("git.stage.denied", { paths: rels, decision: outcome.decision });
          return json({ applied: false, approvalId: handle.id, decision: outcome.decision });
        }
        const { runCommand } = await import("../../util/process.ts");
        const res = await runCommand("git", ["add", "--", ...rels], { cwd: root, timeoutMs: 10_000 });
        state.store.audit("git.stage", { paths: rels, ok: res.ok, approvalId: handle.id });
        return json({ applied: true, ok: res.ok, approvalId: handle.id, stdout: res.stdout.slice(0, 2000), error: res.ok ? null : res.stderr.slice(0, 500) });
      },
    }),
    route({
      id: "git.commit",
      path: "/api/git/commit",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        const root = resolve(process.cwd());
        const body = (await req.json().catch(() => ({}))) as { message?: string };
        const message = (body.message ?? "").trim();
        if (!message) return json({ error: "commit message is required" }, 400);
        if (message.length > 2000) return json({ error: "commit message too long (max 2000)" }, 400);

        const approvalsCfg = config?.approvals;
        const approvalStore = getApprovalStore(state.store, {
          defaultTtlMs: approvalsCfg?.defaultTtlMs,
          perSurface: approvalsCfg?.perSurface,
        });
        const args = { message };
        const handle = approvalStore.request({
          tool: "git_commit",
          args,
          reason: `commit to the project workspace: "${message.slice(0, 120)}"`,
          preview: buildStructuredPreview({ tool: "git_commit", args, reason: `git commit -m ${message}`, cwd: root, riskTier: "high" }),
          riskTier: "high",
          surface: "daemon-git",
        });
        const outcome = await handle.outcome;
        if (!outcome.approved) {
          state.store.audit("git.commit.denied", { decision: outcome.decision });
          return json({ applied: false, approvalId: handle.id, decision: outcome.decision });
        }
        const { runCommand } = await import("../../util/process.ts");
        const res = await runCommand("git", ["commit", "-m", message], { cwd: root, timeoutMs: 15_000 });
        state.store.audit("git.commit", { ok: res.ok, approvalId: handle.id });
        return json({ applied: true, ok: res.ok, approvalId: handle.id, stdout: res.stdout.slice(0, 2000), error: res.ok ? null : res.stderr.slice(0, 500) });
      },
    }),
  ];
}

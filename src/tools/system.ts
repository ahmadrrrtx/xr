/** XR system tools: shared file authority; unchanged governed shell execution. */
import type { Tool, ToolResult } from "../core/types.ts";
import { checkAction } from "../security/guard.ts";
import { FilesystemAuthority, filesystemMessage, withFilesystem } from "../security/filesystem.ts";
import { runCommand } from "../util/process.ts";
import { shellTrustSpec } from "../runtime/trust/tool-support.ts";
import { resolveShellCommandIdentity, decideExecIntegrity } from "../security/exec-integrity.ts";

export const listDirTool: Tool = {
  name: "list_dir", description: "List files/folders inside a directory in the working tree.",
  parameters: { path: "string (relative dir, default '.')" }, requiresApproval: false,
  async run(args, ctx): Promise<ToolResult> {
    let fs: FilesystemAuthority | undefined;
    try {
      fs = ctx.filesystem ?? new FilesystemAuthority(ctx.cwd);
      const entries = fs.list(typeof args.path === "string" ? args.path : ".");
      ctx.audit("list_dir", { path: String(args.path ?? "."), authority: fs.descriptor().id });
      return { ok: true, output: entries.map(e => e.name + (e.directory ? "/" : "")).join("\n") || "(empty)", data: { count: entries.length } };
    } catch (e) { return { ok: false, output: filesystemMessage(e) }; }
    finally { if (fs && fs !== ctx.filesystem) fs.close(); }
  },
};
export const deleteFileTool: Tool = {
  name: "delete_file", description: "Delete a file inside the working tree. Requires approval.",
  parameters: { path: "string (relative path)" }, requiresApproval: true,
  async run(args, ctx): Promise<ToolResult> {
    let fs: FilesystemAuthority | undefined, pending: ReturnType<FilesystemAuthority["prepare"]> | undefined;
    try {
      if (typeof args.path !== "string" || !args.path.trim()) return { ok: false, output: "delete_file requires a non-empty `path`" };
      fs = ctx.filesystem ?? new FilesystemAuthority(ctx.cwd);
      pending = fs.prepare(args.path, "delete");
      const approved = await ctx.approve({ tool: "delete_file", args: { path: pending.path, filesystem: pending.identity }, reason: `delete ${pending.path}`, preview: pending.sensitive ? "(sensitive content withheld)" : pending.oldContent.slice(0, 3000) });
      if (!approved) { ctx.audit("delete_file.denied", { path: pending.path }); return { ok: false, output: "delete denied" }; }
      pending.validate();
      if (ctx.dryRun) { ctx.audit("delete_file.dryrun", { path: pending.path }); return { ok: true, output: `[dry-run] would delete ${pending.path}` }; }
      pending.commit();
      ctx.audit("delete_file.applied", { path: pending.path });
      return { ok: true, output: `deleted ${pending.path}` };
    } catch (e) { return { ok: false, output: filesystemMessage(e) }; }
    finally { pending?.close(); if (fs && fs !== ctx.filesystem) fs.close(); }
  },
};

export const shellTool: Tool = {
  name: "shell",
  description: "Run a shell command in the working dir. Requires approval. Dangerous commands are blocked.",
  parameters: { cmd: "string (command line)" },
  requiresApproval: true,
  async run(args, ctx): Promise<ToolResult> {
    if (typeof args.cmd !== "string" || !args.cmd.trim()) {
      ctx.audit("shell.denied", { reason: "invalid cmd schema" });
      return { ok: false, output: "shell requires a non-empty string `cmd`" };
    }
    const cmd = args.cmd;
    // Phase 06 — an already-cancelled run must not start new side effects.
    if (ctx.signal?.aborted) {
      ctx.audit("shell.cancelled", { stage: "before_start" });
      return { ok: false, output: "shell command cancelled before start" };
    }
    // Phase 07 · Content-hash execution integrity (APPLICATION-LEVEL). Resolve
    // the interpreter + best-effort direct executables, hash their CONTENT
    // (symlink-canonicalized), and decide per XR_EXEC_INTEGRITY mode. Default
    // mode is `audit` (record + allow) so existing workflows are unchanged.
    // This is defense-in-depth, NOT a kernel boundary — see exec-integrity.ts.
    const execIdentity = resolveShellCommandIdentity(cmd, ctx.cwd);
    const execDecision = decideExecIntegrity(execIdentity);
    ctx.audit("shell.exec_identity", {
      mode: execDecision.mode,
      decision: execDecision.decision,
      interpreter: execIdentity.interpreter?.canonical,
      interpreterHash: execIdentity.interpreter?.hash?.slice(0, 16),
      directCount: execIdentity.direct.length,
      unknownCount: execDecision.unknown.length,
      unknown: execDecision.unknown.map((u) => u.token),
    });
    const decision = checkAction({ tool: "shell", args: { cmd } }, {
      egressAllowlist: ctx.egressAllowlist ?? [],
      requireApproval: ["shell"],
    });
    if (!decision.allowed) {
      ctx.audit("shell.blocked", { cmd, reason: decision.reason });
      return { ok: false, output: `blocked: ${decision.reason}` };
    }
    const approved = await ctx.approve({
      tool: "shell",
      // Raw args → interpreted command breakdown in the consent plane +
      // argsHash binding for durable approvals (F-11/F-26).
      args: { cmd },
      reason:
        execDecision.decision === "requireApproval" || execDecision.decision === "deny"
          ? `run: ${cmd}\n\n[execution-integrity ${execDecision.mode}] unknown binary hash(es): ${execDecision.reasons.join("; ")}`
          : `run: ${cmd}`,
      preview: cmd,
    });
    if (!approved) {
      ctx.audit("shell.denied", { cmd });
      return { ok: false, output: "shell denied" };
    }
    if (ctx.dryRun) {
      ctx.audit("shell.dryrun", { cmd });
      return { ok: true, output: `[dry-run] would run: ${cmd}` };
    }
    // XR 4.2 / Phase 4 · T1 — when the runtime provides an isolated runner,
    // execute the shell command inside a verified environment (Tier 2). This
    // FAILS CLOSED if the required isolation is unavailable; it never silently
    // runs in-process. When no isolated runner is wired (deprecated out-of-tree
    // callers), hardened mode (the default) BLOCKS the command outright — the
    // host-authority fallback exists only with hardened mode explicitly OFF
    // (compat path), and is audited as a degraded execution.
    if (ctx.runIsolated) {
      /**
       * Phase 06 · Step 18 — DOCUMENTED LIMITATION: the isolated runner
       * (Trust service environments) does not currently accept an
       * AbortSignal, so cancellation of an in-flight isolated command takes
       * effect at the loop's next checkpoint, not inside the environment.
       * We do NOT pretend the environment stopped; it runs to its own
       * timeout. This is an honest capability gap, not a silent success.
       */
      let filesystemAuthority;
      try { filesystemAuthority = ctx.filesystem?.descriptor() ?? withFilesystem(ctx.cwd, "model-tool", fs => fs.descriptor()); }
      catch (e) { return { ok: false, output: filesystemMessage(e) }; }
      const { request, executable } = shellTrustSpec(cmd, ctx.cwd, {
        timeoutMs: 120_000,
        maxOutputBytes: 4 * 1024 * 1024,
        networkTargets: ctx.egressAllowlist ?? [],
        filesystemAuthority,
      });
      const r = await ctx.runIsolated(request, executable);
      if (r.blocked) {
        ctx.audit("shell.isolated_blocked", { cmd, reason: r.reason });
        return { ok: false, output: `blocked: ${r.reason ?? "isolation unavailable"}` };
      }
      const out = r.stdout + r.stderr;
      ctx.audit("shell.run_isolated", { cmd, exit: r.exitCode, placement: r.placement, verified: r.verified });
      return {
        ok: r.ok,
        output: out.slice(0, 4000) || `(exit ${r.exitCode})`,
        data: { isolated: true, placement: r.placement, verified: r.verified, exit: r.exitCode },
      };
    }
    if (ctx.hardened !== false) {
      ctx.audit("shell.hardened_blocked", { cmd, reason: "no isolated runner wired and hardened mode is on" });
      return {
        ok: false,
        output: "blocked: shell requires an isolated execution environment, but none is wired (hardened mode). Set XR_TRUST_HARDENED=0 only on hosts where this is explicitly accepted.",
      };
    }
    // Phase 07 · Enforcement on the host-authority (degraded) path: in
    // `enforce` mode an unknown/unresolved binary is denied outright (fail
    // closed). The isolated-runner path above remains the stronger boundary
    // and is governed by its own environment, so we do not deny there.
    if (execDecision.decision === "deny") {
      ctx.audit("shell.exec_integrity_denied", { cmd, reasons: execDecision.reasons });
      return { ok: false, output: `blocked by execution-integrity gate (mode=enforce): ${execDecision.reasons.join("; ")}` };
    }
    try {
      // Phase 06 · Step 18 — the run's AbortSignal reaches the subprocess: a
      // Ctrl+C during a shell command terminates the child and is audited as
      // a cancellation (never reported as success or timeout).
      const proc = await runCommand("bash", ["-lc", cmd], {
        cwd: ctx.cwd,
        timeoutMs: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      const out = proc.stdout + proc.stderr;
      if (proc.error === "cancelled") {
        ctx.audit("shell.cancelled", { cmd });
        return { ok: false, output: out.slice(0, 4000) || "shell command cancelled" };
      }
      ctx.audit("shell.run", { cmd, exit: proc.status });
      return { ok: proc.ok, output: out.slice(0, 4000) || `(exit ${proc.status})` };
    } catch (e) {
      return { ok: false, output: `shell error: ${(e as Error).message}` };
    }
  },
};

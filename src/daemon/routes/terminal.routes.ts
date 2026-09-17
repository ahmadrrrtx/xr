/**
 * XR Daemon — terminal routes (Phase 2B · T-1, experimental).
 *
 * POST /api/terminal/run — run ONE shell command in the project root and
 * stream its output over SSE. This powers the XR Desktop workspace terminal.
 *
 * HONEST CAPABILITY STATEMENT (no fake PTY):
 *   This is a line-based command runner, NOT an interactive PTY. There is no
 *   tty allocation, so full-screen interactive programs (vim, htop, less)
 *   will not behave interactively — they run non-attached and their raw
 *   output is streamed as text. A real PTY needs a native module
 *   (node-pty/ConPTY) and is deliberately deferred until it can be built
 *   first-class on all three OSes (D-02). The UI labels this surface
 *   "Terminal (command runner)" — never "PTY".
 *
 * Security posture (same law as the shell tool, src/tools/system.ts):
 *   · deterministic policy FIRST — checkAction() blocks dangerous commands
 *     before any human is asked (SEC: policy is engine-owned, never client);
 *   · every command that passes policy raises a durable approval with the
 *     canonical interpreted-command breakdown (buildStructuredPreview →
 *     shell path: binary resolution + args table, secrets redacted);
 *   · execution is scope-enforced to the project root (cwd), time-boxed
 *     (default 120 s, max 600 s), output-capped (256 KB, truncation is
 *     reported honestly), and streamed without shell-quoting games — the
 *     command line goes to the platform shell as ONE -c argument;
 *   · every transition is audited to the hash-chained log:
 *     terminal.run.requested / .blocked / .denied / .applied / .timeout.
 *
 * Wire (SSE, same framing as /api/chat):
 *   data: {"type":"status","status":"approval_required","approvalId":…}
 *   data: {"type":"output","stream":"stdout"|"stderr","text":…}
 *   data: {"type":"exit","code":…,"truncated":…}
 *   data: {"type":"status","status":"denied"|"blocked"|"error",…}
 *   data: [DONE]
 */

import { resolve } from "node:path";
import { route, type DaemonRoute } from "./router.ts";
import { getApprovalStore } from "../../control/approval-store.ts";
import { buildStructuredPreview } from "../../control/preview.ts";
import { checkAction } from "../../security/guard.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

/** Platform shell argv that runs ONE command line. Mirrors the CLI's own shell choice. */
export function shellArgvFor(cmd: string): string[] {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
    return [comspec, "/d", "/s", "/c", cmd];
  }
  const shell = process.env.SHELL || "/bin/sh";
  return [shell, "-c", cmd];
}

export function terminalRoutes(): DaemonRoute[] {
  return [
    route({
      id: "terminal.run",
      path: "/api/terminal/run",
      method: "POST",
      handle: async ({ req, json, sse, state, config }) => {
        const root = resolve(process.cwd());
        let body: { cmd?: string; timeoutMs?: number };
        try {
          body = (await req.json().catch(() => ({}))) as typeof body;
        } catch {
          return json({ error: "expected JSON body { cmd }" }, 400);
        }
        const cmd = typeof body?.cmd === "string" ? body.cmd.trim() : "";
        if (!cmd) return json({ error: "expected { cmd: string }" }, 400);
        const timeoutMs = Math.min(
          typeof body.timeoutMs === "number" && body.timeoutMs > 0 ? body.timeoutMs : DEFAULT_TIMEOUT_MS,
          MAX_TIMEOUT_MS,
        );

        // ── 1. Deterministic policy gate (engine-owned; runs before consent) ──
        const decision = checkAction({ tool: "shell", args: { cmd } }, { egressAllowlist: [], requireApproval: ["shell"] });
        if (!decision.allowed) {
          state.store.audit("terminal.run.blocked", { cmd, reason: decision.reason });
          return json({ error: `blocked: ${decision.reason}`, blocked: true }, 403);
        }

        // ── 2. Consent plane: durable approval with the canonical breakdown ──
        const approvalsCfg = config?.approvals;
        const approvalStore = getApprovalStore(state.store, {
          defaultTtlMs: approvalsCfg?.defaultTtlMs,
          perSurface: approvalsCfg?.perSurface,
        });
        const reason = `run: ${cmd}`;
        const handle = approvalStore.request({
          tool: "shell",
          args: { cmd },
          reason,
          preview: buildStructuredPreview({ tool: "shell", args: { cmd }, reason, cwd: root, riskTier: "high" }),
          riskTier: "high",
          surface: "daemon-terminal",
        });
        state.store.audit("terminal.run.requested", { cmd, approvalId: handle.id, timeoutMs });

        // ── 3. Stream: approval outcome → spawn → output → exit ──
        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            let closed = false;
            let seq = 0;
            const send = (data: object) => {
              if (closed) return;
              seq += 1;
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ ...data, event_id: seq })}\n\n`));
            };
            const close = () => {
              if (closed) return;
              closed = true;
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
              controller.close();
            };

            try {
              send({ type: "status", status: "approval_required", approvalId: handle.id, cmd, riskTier: handle.record.riskTier, ttlMs: handle.record.ttlMs });
              const outcome = await handle.outcome;
              if (!outcome.approved) {
                send({ type: "status", status: outcome.timedOut ? "timed_out" : "denied", decision: outcome.decision });
                state.store.audit("terminal.run.denied", { cmd, decision: outcome.decision });
                close();
                return;
              }

              const started = Date.now();
              const ac = new AbortController();
              const timer = setTimeout(() => ac.abort(), timeoutMs);
              const [bin, ...argv] = shellArgvFor(cmd);
              let proc;
              try {
                proc = Bun.spawn([bin, ...argv], {
                  cwd: root,
                  stdin: "ignore",
                  stdout: "pipe",
                  stderr: "pipe",
                  signal: ac.signal,
                  windowsHide: true,
                });
              } catch (e) {
                clearTimeout(timer);
                send({ type: "status", status: "error", error: `spawn failed: ${String(e)}` });
                state.store.audit("terminal.run.error", { cmd, error: String(e) });
                close();
                return;
              }

              let emitted = 0;
              let truncated = false;
              const pump = async (rs: ReadableStream<Uint8Array>, which: "stdout" | "stderr") => {
                const dec = new TextDecoder();
                const reader = rs.getReader();
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (!value) continue;
                  if (emitted >= MAX_OUTPUT_BYTES) { truncated = true; continue; }
                  const room = MAX_OUTPUT_BYTES - emitted;
                  const slice = value.length > room ? value.subarray(0, room) : value;
                  if (value.length > room) truncated = true;
                  emitted += slice.length;
                  send({ type: "output", stream: which, text: dec.decode(slice, { stream: true }) });
                }
              };
              await Promise.all([pump(proc.stdout, "stdout"), pump(proc.stderr, "stderr")]);
              const exitCode = await proc.exited;
              clearTimeout(timer);
              const timedOut = ac.signal.aborted;
              const ms = Date.now() - started;
              send({ type: "exit", code: exitCode, timedOut, truncated, ms });
              if (timedOut) {
                state.store.audit("terminal.run.timeout", { cmd, timeoutMs, ms });
              } else {
                state.store.audit("terminal.run.applied", { cmd, exit: exitCode, ms, bytes: emitted, truncated });
              }
              close();
            } catch (e) {
              send({ type: "status", status: "error", error: String(e) });
              try {
                state.store.audit("terminal.run.error", { cmd, error: String(e) });
              } catch { /* audit sink may be absent in minimal contexts */ }
              close();
            }
          },
        });
        return sse(stream);
      },
    }),
  ];
}

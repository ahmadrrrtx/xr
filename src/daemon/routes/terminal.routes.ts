/**
 * XR Daemon — terminal routes (Phase 2B · T-1, experimental).
 *
 * POST /api/terminal/run — run ONE shell command in the project root and
 * stream its output over SSE. This powers the XR Desktop workspace terminal.
 *
 * HONEST CAPABILITY STATEMENT:
 *   /api/terminal/run is a line-based command runner, NOT an interactive PTY:
 *   no tty is allocated, so full-screen programs run non-attached and their
 *   raw output is streamed as text. It stays for one-shot, per-command
 *   approvals (the approvals demos and the agent's own shell tool).
 *
 *   /api/terminal/pty (Phase 2 · G-05) IS a real pseudo-terminal, engine-owned,
 *   through `Bun.spawn({ terminal })` — openpty on Linux/macOS, ConPTY on
 *   Windows, no native addon (the old note that a PTY "needs node-pty" was
 *   true for bun < 1.3 and is not true any more). Consent is per SESSION, not
 *   per keystroke: opening a shell raises ONE durable high-tier approval whose
 *   preview says plainly that keystrokes typed into it are executed by the
 *   shell directly and are not policy-inspected. Everything else the engine
 *   can enforce, it enforces: cwd inside the project root, session cap,
 *   input cap, output high-water mark with REPORTED drops, kill on client
 *   disconnect and on daemon exit, XR credentials stripped from the shell's
 *   environment. Wire: POST /pty (SSE), POST /pty/:id/input, POST
 *   /pty/:id/resize, DELETE /pty/:id, GET /pty. Session logic lives in
 *   src/daemon/pty-sessions.ts.
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
import { statSync } from "node:fs";
import { route, type DaemonRoute } from "./router.ts";
import { getApprovalStore } from "../../control/approval-store.ts";
import { buildStructuredPreview } from "../../control/preview.ts";
import { checkAction } from "../../security/guard.ts";
import { insideRoot } from "./files.routes.ts";
import { clampSize, defaultShell, getPtyRegistry, PTY_OUTPUT_HIGH_WATER_BYTES, type PtySession } from "../pty-sessions.ts";

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
    ...ptyRoutes(),
  ];
}

const PTY_PREFIX = "/api/terminal/pty/";

/** `/api/terminal/pty/<id>/<action>` → { id, action } (action may be ""). */
function parsePtyPath(path: string): { id: string; action: string } | null {
  if (!path.startsWith(PTY_PREFIX)) return null;
  const rest = path.slice(PTY_PREFIX.length);
  const [id = "", action = ""] = rest.split("/");
  if (!id) return null;
  return { id: decodeURIComponent(id), action };
}

function ptyRoutes(): DaemonRoute[] {
  return [
    route({
      id: "terminal.pty.list",
      path: "/api/terminal/pty",
      method: "GET",
      handle: ({ json }) => json({ sessions: getPtyRegistry().list(), cap: getPtyRegistry().maxSessions }),
    }),
    route({
      id: "terminal.pty.open",
      path: "/api/terminal/pty",
      method: "POST",
      handle: async ({ req, json, sse, state, config }) => {
        const root = resolve(process.cwd());
        let body: { cwd?: string; cols?: number; rows?: number };
        try {
          body = (await req.json().catch(() => ({}))) as typeof body;
        } catch {
          return json({ error: "expected JSON body" }, 400);
        }
        const relCwd = typeof body?.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : ".";
        const cwd = insideRoot(root, relCwd);
        if (!cwd) return json({ error: "cwd escapes the project root" }, 400);
        try {
          if (!statSync(cwd).isDirectory()) return json({ error: "cwd is not a directory" }, 400);
        } catch {
          return json({ error: "cwd does not exist" }, 400);
        }
        const size = clampSize(body?.cols, body?.rows);
        const registry = getPtyRegistry();
        if (registry.size >= registry.maxSessions) {
          return json({ error: `terminal session cap reached (${registry.maxSessions}); close one first`, cap: registry.maxSessions }, 429);
        }
        const [shell] = defaultShell();

        // ── 1. Deterministic policy gate (engine-owned; runs before consent) ──
        const decision = checkAction({ tool: "shell", args: { cmd: shell } }, { egressAllowlist: [], requireApproval: ["shell"] });
        if (!decision.allowed) {
          state.store.audit("terminal.pty.blocked", { shell, cwd: relCwd, reason: decision.reason });
          return json({ error: `blocked: ${decision.reason}`, blocked: true }, 403);
        }

        // ── 2. Consent plane: ONE durable approval per session, preview tells the truth ──
        const approvalsCfg = config?.approvals;
        const approvalStore = getApprovalStore(state.store, {
          defaultTtlMs: approvalsCfg?.defaultTtlMs,
          perSurface: approvalsCfg?.perSurface,
        });
        const reason =
          `open an interactive terminal (${shell}) in ${relCwd === "." ? "the project root" : relCwd} — ` +
          "everything typed into it runs as you, directly in the shell; XR's policy gate does not see those keystrokes";
        const handle = approvalStore.request({
          tool: "shell",
          args: { cmd: shell, cwd: relCwd, interactive: true },
          reason,
          preview: buildStructuredPreview({ tool: "shell", args: { cmd: `${shell} (interactive session)`, cwd: relCwd }, reason, cwd: root, riskTier: "high" }),
          riskTier: "high",
          surface: "daemon-terminal",
        });
        state.store.audit("terminal.pty.requested", { shell, cwd: relCwd, approvalId: handle.id, cols: size.cols, rows: size.rows });

        // ── 3. Stream: approval outcome → spawn → live output → exit ──
        let sessionId: string | null = null;
        let closed = false; // shared with cancel(): a departed client must never be enqueued to
        const stream = new ReadableStream(
          {
            async start(controller) {
              const enc = new TextEncoder();
              let seq = 0;
              const send = (data: object) => {
                if (closed) return;
                seq += 1;
                try {
                  controller.enqueue(enc.encode(`data: ${JSON.stringify({ ...data, event_id: seq })}\n\n`));
                } catch {
                  closed = true; // the consumer is gone; the session is torn down by cancel()
                }
              };
              const close = () => {
                if (closed) return;
                closed = true;
                try {
                  controller.enqueue(enc.encode("data: [DONE]\n\n"));
                  controller.close();
                } catch {
                  /* already closed by the client */
                }
              };
              try {
                send({ type: "status", status: "approval_required", approvalId: handle.id, shell, cwd: relCwd, riskTier: handle.record.riskTier, ttlMs: handle.record.ttlMs });
                const outcome = await handle.outcome;
                if (!outcome.approved) {
                  send({ type: "status", status: outcome.timedOut ? "timed_out" : "denied", decision: outcome.decision });
                  state.store.audit("terminal.pty.denied", { shell, cwd: relCwd, decision: outcome.decision });
                  close();
                  return;
                }
                let session: PtySession | undefined;
                try {
                  session = registry.open({
                    cwd,
                    cols: size.cols,
                    rows: size.rows,
                    onData: (text) => {
                      // Backpressure is measured in bytes the client has not drained.
                      const desired = controller.desiredSize ?? 0;
                      if (desired <= 0 && session) {
                        // Stream buffer full: count as pending so the session starts dropping and REPORTS it.
                        session.pendingBytes = PTY_OUTPUT_HIGH_WATER_BYTES + 1;
                      }
                      send({ type: "output", data: text });
                      session?.consumed(Buffer.byteLength(text, "utf8"));
                    },
                    onDropped: (bytes) => send({ type: "status", status: "output_dropped", bytes }),
                    onExit: (exit) => {
                      send({ type: "exit", code: exit.code, signal: exit.signal });
                      try {
                        state.store.audit("terminal.pty.exited", { sessionId, shell, cwd: relCwd, code: exit.code, signal: exit.signal });
                      } catch {
                        /* audit sink may be absent */
                      }
                      close();
                    },
                  });
                } catch (e) {
                  send({ type: "status", status: "error", error: `spawn failed: ${String(e)}` });
                  state.store.audit("terminal.pty.error", { shell, cwd: relCwd, error: String(e) });
                  close();
                  return;
                }
                sessionId = session.id;
                state.store.audit("terminal.pty.opened", { sessionId, pid: session.pid, shell, cwd: relCwd, cols: session.cols, rows: session.rows });
                send({ type: "status", status: "open", sessionId: session.id, pid: session.pid, shell, cwd: relCwd, cols: session.cols, rows: session.rows });
              } catch (e) {
                send({ type: "status", status: "error", error: String(e) });
                try {
                  state.store.audit("terminal.pty.error", { shell, cwd: relCwd, error: String(e) });
                } catch {
                  /* audit sink may be absent */
                }
                close();
              }
            },
            cancel() {
              // Client went away (tab closed, app quit, network drop): the shell
              // gets the closing-window treatment. No orphaned shells.
              closed = true;
              if (sessionId) {
                const id = sessionId;
                void getPtyRegistry()
                  .close(id)
                  .then((exit) => {
                    try {
                      state.store.audit("terminal.pty.killed", { sessionId: id, by: "disconnect", exit });
                    } catch {
                      /* audit sink may be absent */
                    }
                  });
              }
            },
          },
          new ByteLengthQueuingStrategy({ highWaterMark: PTY_OUTPUT_HIGH_WATER_BYTES }),
        );
        return sse(stream);
      },
    }),
    route({
      id: "terminal.pty.input",
      prefix: PTY_PREFIX,
      pattern: /^\/api\/terminal\/pty\/[^/]+\/input$/,
      method: "POST",
      handle: async ({ req, json, path }) => {
        const parsed = parsePtyPath(path);
        if (!parsed) return json({ error: "expected /api/terminal/pty/<id>/input" }, 400);
        const session = getPtyRegistry().get(parsed.id);
        if (!session) return json({ error: "no such terminal session" }, 404);
        const body = (await req.json().catch(() => ({}))) as { data?: unknown };
        if (typeof body.data !== "string") return json({ error: "expected { data: string }" }, 400);
        if (!session.alive) return json({ error: "session has exited", exit: session.exit }, 409);
        try {
          session.write(body.data);
        } catch (e) {
          const msg = (e as Error).message;
          return json({ error: msg }, msg.includes("exceeds") ? 413 : 409);
        }
        return json({ ok: true, bytes: Buffer.byteLength(body.data, "utf8") });
      },
    }),
    route({
      id: "terminal.pty.resize",
      prefix: PTY_PREFIX,
      pattern: /^\/api\/terminal\/pty\/[^/]+\/resize$/,
      method: "POST",
      handle: async ({ req, json, path }) => {
        const parsed = parsePtyPath(path);
        if (!parsed) return json({ error: "expected /api/terminal/pty/<id>/resize" }, 400);
        const session = getPtyRegistry().get(parsed.id);
        if (!session) return json({ error: "no such terminal session" }, 404);
        const body = (await req.json().catch(() => ({}))) as { cols?: unknown; rows?: unknown };
        if (!session.alive) return json({ error: "session has exited", exit: session.exit }, 409);
        const size = session.resize(Number(body.cols), Number(body.rows));
        return json({ ok: true, ...size });
      },
    }),
    route({
      id: "terminal.pty.close",
      prefix: PTY_PREFIX,
      pattern: /^\/api\/terminal\/pty\/[^/]+$/,
      method: "DELETE",
      handle: async ({ json, path, state }) => {
        const parsed = parsePtyPath(path);
        if (!parsed) return json({ error: "expected DELETE /api/terminal/pty/<id>" }, 400);
        const registry = getPtyRegistry();
        const session = registry.get(parsed.id);
        if (!session) return json({ error: "no such terminal session" }, 404);
        const exit = await registry.close(parsed.id);
        state.store.audit("terminal.pty.killed", { sessionId: parsed.id, by: "request", exit });
        return json({ ok: true, exit });
      },
    }),
  ];
}

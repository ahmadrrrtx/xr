/**
 * XR — SEC-06 child control channel (approval/cancel transport with timeouts).
 *
 * WHY: on POSIX the engine can signal spawned children directly, but on
 * Windows signal semantics are weaker (the historical win32 test skips in
 * test/execution/cancellation.test.ts are the symptom). This module gives
 * BOTH platforms one local transport with identical semantics:
 *
 *   · Windows  → named pipe  `\\.\pipe\xr-ctrl-<pid>`
 *   · elsewhere→ unix socket `<tmpdir>/xr-ctrl-<pid>.sock`
 *
 * through node's `net` (the same API serves both address forms), so the code
 * path tested on Linux in CI is the code path that runs on Windows.
 *
 * CONTRACT: every request has an explicit timeout and FAILS CLOSED — an
 * unanswered or errored request resolves to `{ ok: false, reason }`, which
 * callers must treat as a denial/cancellation and audit. The channel never
 * grants anything by itself; approval decisions still come from the engine's
 * durable store (SEC-07 boundary is untouched — this is a transport, not a
 * policy).
 */
import { rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ControlMessage {
  type: "cancel" | "approval-decision";
  id?: string;
  approved?: boolean;
  reason?: string;
}

export interface ControlReply {
  ok: boolean;
  reason?: string;
}

export const isWin32 = process.platform === "win32";

/** Per-process address; pipes on Windows, socket file elsewhere. */
export function controlAddress(pid: number = process.pid): string {
  return isWin32 ? `\\\\.\\pipe\\xr-ctrl-${pid}` : join(tmpdir(), `xr-ctrl-${pid}.sock`);
}

type Handler = (msg: ControlMessage) => ControlReply | Promise<ControlReply>;

export interface ControlServer {
  address: string;
  /** Fire one message at a connected child; fail-closed on timeout/error. */
  request(msg: ControlMessage, timeoutMs?: number): Promise<ControlReply>;
  /** Resolves once the listener is fully released (Windows pipes need this
      before the same pid can serve again — e.g. sequential test serves). */
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 2500;

function forEachLine(sock: net.Socket, onLine: (line: string) => void): void {
  let buf = "";
  sock.on("data", (d) => {
    buf += d.toString("utf8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) onLine(line);
    }
  });
}

/** Push one message to a child's channel; fail-closed on timeout/error. */
export function sendControl(
  address: string,
  msg: ControlMessage,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ControlReply> {
  return new Promise((resolve) => {
    const sock = net.connect(address);
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ ok: false, reason: "timeout" }); // fail closed
    }, timeoutMs);
    sock.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: "connect-error" }); // fail closed
    });
    let done = false;
    forEachLine(sock, (line) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      try {
        resolve(JSON.parse(line) as ControlReply);
      } catch {
        resolve({ ok: false, reason: "bad-reply" });
      }
    });
    sock.on("connect", () => sock.write(`${JSON.stringify(msg)}\n`));
  });
}

/** Engine side: serve the channel and be able to push messages to children. */
export function serveControlChannel(handler: Handler): ControlServer {
  const address = controlAddress();
  const socks = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    forEachLine(sock, (line) => {
      let msg: ControlMessage;
      try {
        msg = JSON.parse(line) as ControlMessage;
      } catch {
        if (!sock.destroyed) sock.write(`${JSON.stringify({ ok: false, reason: "bad-json" })}\n`);
        return;
      }
      void Promise.resolve(handler(msg))
        .then((reply) => { if (!sock.destroyed) sock.write(`${JSON.stringify(reply)}\n`); })
        .catch(() => { if (!sock.destroyed) sock.write(`${JSON.stringify({ ok: false, reason: "handler-error" })}\n`); });
    });
    sock.on("error", () => sock.destroy());
  });
  server.listen(address);

  const request = (msg: ControlMessage, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ControlReply> =>
    sendControl(address, msg, timeoutMs);

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      for (const s of socks) s.destroy();
      socks.clear();
      server.close(() => {
        if (!isWin32) {
          // unix socket file is ours to clean up; pipes vanish with the process.
          try { rmSync(address, { force: true }); } catch { /* already gone */ }
        }
        resolve();
      });
    });

  return { address, request, close };
}

/** Child side: listen for control messages, reply with acks. */
export function connectControlChannel(
  address: string,
  onMessage: Handler,
): { close: () => void; connected: Promise<void> } {
  const sock = net.connect(address);
  let connectedResolve: () => void = () => undefined;
  const connected = new Promise<void>((r) => { connectedResolve = r; });
  sock.on("connect", connectedResolve);
  forEachLine(sock, (line) => {
    let msg: ControlMessage;
    try {
      msg = JSON.parse(line) as ControlMessage;
    } catch {
      return;
    }
    void Promise.resolve(onMessage(msg))
      .then((reply) => { if (!sock.destroyed) sock.write(`${JSON.stringify(reply)}\n`); })
      .catch(() => { if (!sock.destroyed) sock.write(`${JSON.stringify({ ok: false, reason: "handler-error" })}\n`); });
  });
  sock.on("error", () => sock.destroy());
  return { close: () => sock.destroy(), connected };
}

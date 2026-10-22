/**
 * Daemon session (extension host only).
 *
 * Owns the connection state the status bar and the panel show, the token
 * lookup, and the optional "Start XR" child process. All daemon HTTP runs here,
 * so the webview never needs a network permission.
 *
 * The token is never written to disk by this extension. A token from a daemon
 * it started lives in memory for the session only. Stored tokens live in VS
 * Code's SecretStorage, which is backed by the OS keychain.
 *
 * XR-LAUNCH-034 — durable pairing without long-lived secrets: the daemon writes
 * its current (per-start) token to `<XR home>/daemon/token`. Every refresh
 * re-reads it, every token source is tried in order, and any 401/403 from a
 * live request triggers an immediate refresh, so a daemon restart reconnects
 * without re-pairing.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as os from "node:os";
import * as vscode from "vscode";
import { DaemonClient, DaemonHttpError } from "./daemon/client";
import { resolveTokens } from "./daemon/token";
import { connectWithTokens } from "./daemon/connect";
import { describeTokenFileProblem, readDaemonTokenFile } from "./daemon/token-file";
import { assertLoopbackDaemonUrl, DEFAULT_DAEMON_URL } from "./daemon/url";
import type { DaemonStatus } from "./shared/protocol";

export const TOKEN_SECRET_KEY = "xr.daemonToken";
const POLL_MS = 20000;
const START_TIMEOUT_MS = 15000;
const MAX_LOG_LINE = 500;
/** At most one rejection-triggered refresh per window (inline suggestions can fire often). */
const AUTH_REFRESH_MIN_MS = 2000;

type Listener = (status: DaemonStatus) => void;

export class DaemonSession implements vscode.Disposable {
  private client: DaemonClient | null = null;
  private current: DaemonStatus = { state: "connecting" };
  private sessionToken: string | undefined;
  private child: ChildProcess | undefined;
  private timer: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> | null = null;
  private lastAuthRefresh = 0;
  private readonly listeners = new Set<Listener>();
  private readonly output: vscode.OutputChannel;

  constructor(private readonly secrets: vscode.SecretStorage) {
    this.output = vscode.window.createOutputChannel("XR daemon");
  }

  get status(): DaemonStatus {
    return this.current;
  }

  /** The connected client, or null. Call ensureClient() first if it may be stale. */
  get transport(): DaemonClient | null {
    return this.client;
  }

  onStatus(listener: Listener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
    this.timer.unref?.();
  }

  /** Refresh if needed, then return a connected client or null. */
  async ensureClient(): Promise<DaemonClient | null> {
    if (!(this.client && this.current.state === "connected")) await this.refresh();
    return this.current.state === "connected" ? this.client : null;
  }

  /**
   * Force a refresh (re-reading the token file) and return the client. Used
   * after a request was rejected, e.g. because the daemon restarted with a new
   * token. Returns null when no token is accepted.
   */
  async reconnect(): Promise<DaemonClient | null> {
    await this.refresh();
    return this.current.state === "connected" ? this.client : null;
  }

  /** A live request got 401/403: the daemon probably restarted. Re-read the token now. */
  private onRejected(client: DaemonClient): void {
    if (this.client !== client) return;
    const now = Date.now();
    if (now - this.lastAuthRefresh < AUTH_REFRESH_MIN_MS) return;
    this.lastAuthRefresh = now;
    void this.refresh();
  }

  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("xr");
    let origin: string;
    try {
      origin = assertLoopbackDaemonUrl(cfg.get<string>("daemonUrl", DEFAULT_DAEMON_URL));
    } catch (err) {
      this.client = null;
      this.publish({ state: "offline", detail: errorMessage(err) });
      return;
    }

    let version: string | undefined;
    try {
      version = (await new DaemonClient(origin, "").health()).version;
    } catch {
      this.client = null;
      this.publish({ state: "offline", detail: "XR is not running on this computer." });
      return;
    }

    const { tokens, fileProblem } = await this.findTokens(cfg.get<string>("token", ""));
    if (tokens.length === 0) {
      this.client = null;
      this.publish({
        state: "unauthorized",
        version,
        detail: fileProblem ?? "No daemon token. Run XR: Start XR from VS Code, or XR: Set daemon token.",
      });
      return;
    }

    // Try every source in order; a rejected token falls through to the next.
    const result = await connectWithTokens(tokens, (t) => new DaemonClient(origin, t));
    if (result.kind === "connected") {
      const bearer = result.token.token;
      // Keep the existing client when the token is unchanged, so in-flight users see one object.
      const keep = this.client && this.client.bearer === bearer ? this.client : null;
      const live: DaemonClient = keep ?? new DaemonClient(origin, bearer, fetch, () => this.onRejected(live));
      this.client = live;
      this.publish({
        state: "connected",
        version,
        provider: result.providers.primary,
        model: result.providers.model,
        spendTodayUsd: result.budget.usage.dayUsd,
      });
      return;
    }
    this.client = null;
    if (result.kind === "error") {
      this.publish({ state: "offline", version, detail: errorMessage(result.error) });
      return;
    }
    const sources = result.kind === "rejected" ? result.sources.join(", ") : "none";
    const hint = fileProblem ? ` ${fileProblem}` : "";
    this.publish({ state: "unauthorized", version, detail: `The daemon rejected the token (${sources}).${hint}` });
  }

  private async findTokens(setting: string) {
    const file = readDaemonTokenFile();
    const tokens = resolveTokens({
      setting,
      environment: process.env.XR_DAEMON_TOKEN,
      session: this.sessionToken,
      daemonFile: file.ok ? file.token : undefined,
      secretStorage: await this.secrets.get(TOKEN_SECRET_KEY),
    });
    return { tokens, fileProblem: describeTokenFileProblem(file) };
  }

  private async findToken(setting: string) {
    return (await this.findTokens(setting)).tokens[0] ?? null;
  }

  private publish(status: DaemonStatus): void {
    this.current = status;
    for (const l of this.listeners) l(status);
  }

  /**
   * Start `xr serve` from VS Code when nothing is listening. The command is
   * an application setting, so a repository cannot choose it. The daemon hides
   * its token from the terminal and writes it to its owner-only token file,
   * which the next refresh reads. (If the operator set XR_PRINT_TOKEN=1, a
   * printed token is kept in memory only.) Log lines that mention a token are
   * never written to the output channel.
   */
  async startDaemon(): Promise<boolean> {
    await this.refresh();
    // A daemon already answers (possibly without a token): do not start a second one on the same port.
    if (this.current.state !== "offline") return this.current.state === "connected";
    if (this.child && this.child.exitCode === null) return this.waitForDaemon(Date.now() + START_TIMEOUT_MS);

    const cfg = vscode.workspace.getConfiguration("xr");
    const command = cfg.get<string>("daemonCommand", "xr serve").trim();
    if (!command) return false;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    this.output.appendLine(`$ ${command}`);
    const child = spawn(command, { shell: true, cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    const onChunk = (chunk: Buffer) => {
      for (const raw of String(chunk).split(/\r?\n/)) {
        const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd();
        if (!line) continue;
        const m = /token\W*([A-Za-z0-9_-]{16,})/i.exec(line);
        if (m && !this.sessionToken) this.sessionToken = m[1];
        // Never log a line that carries the token.
        this.output.appendLine(/token/i.test(line) ? "[token line hidden]" : line.slice(0, MAX_LOG_LINE));
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("exit", (code) => {
      this.output.appendLine(`XR exited with code ${code ?? "unknown"}.`);
      if (this.child === child) {
        this.child = undefined;
        this.sessionToken = undefined;
      }
      void this.refresh();
    });
    return this.waitForDaemon(Date.now() + START_TIMEOUT_MS);
  }

  private async waitForDaemon(deadline: number): Promise<boolean> {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      await this.refresh();
      if (this.current.state === "connected") return true;
      if (!this.child) break;
    }
    return this.current.state === "connected";
  }

  async setToken(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: "XR daemon token",
      prompt: "Paste the token printed by `xr serve`. It is stored in the OS keychain.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().length < 16 ? "That looks too short to be a daemon token." : undefined),
    });
    if (!value?.trim()) return;
    await this.secrets.store(TOKEN_SECRET_KEY, value.trim());
    await this.refresh();
  }

  async forgetToken(): Promise<void> {
    await this.secrets.delete(TOKEN_SECRET_KEY);
    await this.refresh();
  }

  /** Show the daemon output channel. */
  showOutput(): void {
    this.output.show(true);
  }

  /**
   * Dashboard URL on the configured loopback origin. The token is added only when
   * one is already known, using the daemon's `?token=` bootstrap parameter.
   */
  async dashboardUrl(): Promise<string | null> {
    const cfg = vscode.workspace.getConfiguration("xr");
    let origin: string;
    try {
      origin = assertLoopbackDaemonUrl(cfg.get<string>("daemonUrl", DEFAULT_DAEMON_URL));
    } catch {
      return null;
    }
    // Prefer the token the live connection proved; else the first configured one.
    const token = this.current.state === "connected" && this.client ? this.client.bearer : (await this.findToken(cfg.get<string>("token", "")))?.token;
    const url = new URL("/", origin);
    if (token) url.searchParams.set("token", token);
    return url.toString();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    // Stop only a daemon this extension started. A daemon the user started keeps running.
    if (this.child && this.child.exitCode === null) this.child.kill();
    this.child = undefined;
    this.listeners.clear();
    this.output.dispose();
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "TimeoutError") return "The daemon did not answer in time.";
  if (err instanceof DaemonHttpError) return err.message;
  if (err instanceof Error) return err.message.slice(0, 200);
  return "The daemon is not reachable.";
}

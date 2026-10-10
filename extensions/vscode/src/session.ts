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
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as os from "node:os";
import * as vscode from "vscode";
import { DaemonClient, DaemonHttpError } from "./daemon/client";
import { describeSource, resolveToken } from "./daemon/token";
import { assertLoopbackDaemonUrl, DEFAULT_DAEMON_URL } from "./daemon/url";
import type { DaemonStatus } from "./shared/protocol";

export const TOKEN_SECRET_KEY = "xr.daemonToken";
const POLL_MS = 20000;
const START_TIMEOUT_MS = 15000;
const MAX_LOG_LINE = 500;

type Listener = (status: DaemonStatus) => void;

export class DaemonSession implements vscode.Disposable {
  private client: DaemonClient | null = null;
  private current: DaemonStatus = { state: "connecting" };
  private sessionToken: string | undefined;
  private child: ChildProcess | undefined;
  private timer: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> | null = null;
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

    const token = await this.findToken(cfg.get<string>("token", ""));
    const probe = new DaemonClient(origin, token?.token ?? "");
    let version: string | undefined;
    try {
      version = (await probe.health()).version;
    } catch {
      this.client = null;
      this.publish({ state: "offline", detail: "XR is not running on this computer." });
      return;
    }

    if (!token) {
      this.client = null;
      this.publish({
        state: "unauthorized",
        version,
        detail: "No daemon token. Run XR: Set daemon token, or XR: Start XR from VS Code.",
      });
      return;
    }

    try {
      const [budget, providers] = await Promise.all([probe.budget(), probe.providers()]);
      this.client = probe;
      this.publish({
        state: "connected",
        version,
        provider: providers.primary,
        model: providers.model,
        spendTodayUsd: budget.usage.dayUsd,
      });
    } catch (err) {
      this.client = null;
      if (err instanceof DaemonHttpError && (err.status === 401 || err.status === 403)) {
        this.publish({ state: "unauthorized", version, detail: `The daemon rejected the token (${describeSource(token.source)}).` });
      } else {
        this.publish({ state: "offline", version, detail: errorMessage(err) });
      }
    }
  }

  private async findToken(setting: string) {
    return resolveToken({
      setting,
      environment: process.env.XR_DAEMON_TOKEN,
      session: this.sessionToken,
      secretStorage: await this.secrets.get(TOKEN_SECRET_KEY),
    });
  }

  private publish(status: DaemonStatus): void {
    this.current = status;
    for (const l of this.listeners) l(status);
  }

  /**
   * Start `xr serve` from VS Code when nothing is listening. The command is
   * an application setting, so a repository cannot choose it. The printed
   * token is kept in memory only, and log lines that mention a token are not
   * written to the output channel.
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
    const token = await this.findToken(cfg.get<string>("token", ""));
    const url = new URL("/", origin);
    if (token) url.searchParams.set("token", token.token);
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

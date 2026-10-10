/**
 * The XR side panel: a webview view that hosts the React chat.
 *
 * The host owns the state. The webview posts requests and renders the patches
 * it receives. The HTML sets a strict CSP, so the webview has no network
 * access and cannot load anything except the bundled script and stylesheet.
 */

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { ChatController } from "./chat/controller";
import { confirmApproval } from "./approvals";
import { applyToEditor, diffWithEditor, ProposalContent } from "./editor/apply";
import { editorSnapshot } from "./editor/context";
import { XrDiagnostics } from "./editor/diagnostics";
import { openWorkspaceFile } from "./editor/open";
import type { DaemonSession } from "./session";
import { isToHost, type ToWebview } from "./shared/protocol";

export const CHAT_VIEW_ID = "xr.chat";

export function readMode(): "ask" | "agent" {
  return vscode.workspace.getConfiguration("xr").get<string>("mode") === "agent" ? "agent" : "ask";
}

export class XrChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private iconUri = "";
  private readonly subs: vscode.Disposable[] = [];
  readonly controller: ChatController;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: DaemonSession,
    private readonly diagnostics: XrDiagnostics,
    private readonly proposals: ProposalContent,
  ) {
    this.controller = new ChatController(
      {
        transport: () => session.transport,
        mode: readMode,
        editor: editorSnapshot,
        confirmApproval,
        publish: (msg) => this.post(msg),
        onDiagnostics: (items) => {
          void this.diagnostics.publish(items).then((r) => {
            const note = r.dropped > 0 ? ` (${r.dropped} did not match a line in this workspace)` : "";
            if (r.shown > 0) vscode.window.setStatusBarMessage(`XR added ${r.shown} problems${note}.`, 6000);
          });
        },
        status: () => session.status,
      },
      () => this.iconUri,
    );

    this.subs.push(
      session.onStatus((status) => this.post({ type: "status", status })),
      vscode.window.onDidChangeActiveTextEditor(() => this.pushContext()),
      vscode.window.onDidChangeTextEditorSelection(() => this.pushContext()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    this.iconUri = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "xr-sentinel.svg")).toString();
    view.webview.html = this.html(view.webview, media);
    const msgSub = view.webview.onDidReceiveMessage((msg: unknown) => this.onMessage(msg));
    view.onDidDispose(() => {
      msgSub.dispose();
      if (this.view === view) this.view = undefined;
    });
  }

  /** Focus the panel. Creates the webview if it has not been shown yet. */
  reveal(): void {
    void vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
  }

  /** Send a prompt from a command, with the panel focused so the answer is visible. */
  async sendFromCommand(prompt: string, opts: { attachSelection?: boolean; label?: string } = {}): Promise<void> {
    this.reveal();
    await this.session.ensureClient();
    await this.controller.send(prompt, opts);
  }

  /** Attach the current selection to the next message and prefill nothing. */
  attachSelectionAndReveal(): void {
    this.controller.setAttachSelection(true);
    this.reveal();
  }

  /** Re-send the full state, for example after a settings change. */
  resyncState(): void {
    this.post({ type: "init", state: this.controller.snapshot() });
  }

  dispose(): void {
    this.controller.stop();
    for (const s of this.subs) s.dispose();
  }

  private pushContext(): void {
    this.post({ type: "context", context: this.controller.contextChip() });
  }

  private post(msg: ToWebview): void {
    void this.view?.webview.postMessage(msg);
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isToHost(raw)) return;
    switch (raw.type) {
      case "ready":
        this.post({ type: "init", state: this.controller.snapshot() });
        void this.session.refresh();
        return;
      case "send":
        await this.session.ensureClient();
        await this.controller.send(raw.text);
        return;
      case "stop":
        this.controller.stop();
        return;
      case "clear":
        this.controller.clear();
        return;
      case "toggleAttach":
        this.controller.toggleAttachSelection();
        return;
      case "openFile":
        await openWorkspaceFile({ path: raw.path, line: raw.line });
        return;
      case "openLink":
        if (/^https?:\/\//i.test(raw.href)) await vscode.env.openExternal(vscode.Uri.parse(raw.href));
        return;
      case "apply":
        await applyToEditor(raw.code);
        return;
      case "diff":
        await diffWithEditor(raw.code, raw.language, this.proposals);
        return;
      case "copy":
        await vscode.env.clipboard.writeText(raw.code);
        vscode.window.setStatusBarMessage("XR: copied.", 2500);
        return;
      case "switchModel":
        await vscode.commands.executeCommand("xr.switchModel");
        return;
      case "showBudget":
        await vscode.commands.executeCommand("xr.showBudget");
        return;
      case "startDaemon":
        await vscode.commands.executeCommand("xr.startDaemon");
        return;
      case "setToken":
        await vscode.commands.executeCommand("xr.setToken");
        return;
    }
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "webview.js"));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "webview.css"));
    const nonce = randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>XR</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

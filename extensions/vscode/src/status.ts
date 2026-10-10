/**
 * Status bar item: connection state, model, and today's spend.
 * Clicking it opens the XR menu.
 */

import * as vscode from "vscode";
import type { DaemonStatus } from "./shared/protocol";
import { statusText, statusTooltip } from "./status-format";

export class XrStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "xr.statusMenu";
    this.item.name = "XR";
    this.item.show();
  }

  update(status: DaemonStatus, inlineOn: boolean): void {
    this.item.text = statusText(status, inlineOn);
    this.item.tooltip = statusTooltip(status, inlineOn);
    this.item.backgroundColor =
      status.state === "unauthorized" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}

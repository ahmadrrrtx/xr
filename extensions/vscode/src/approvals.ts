/**
 * Approval modal for daemon tool calls that need consent.
 *
 * Only Approve and Deny are offered. The daemon's decision route has no
 * "always allow" grant, so the extension cannot offer one without a daemon
 * change. Dismissing the dialog counts as Deny.
 */

import * as vscode from "vscode";
import type { ApprovalRequest } from "./chat/controller";

const MAX_PREVIEW = 800;

export async function confirmApproval(req: ApprovalRequest): Promise<boolean> {
  const parts = [req.reason || "XR wants to run a tool that changes something on this computer."];
  if (req.riskTier) parts.push(`Risk: ${req.riskTier}`);
  if (req.preview) {
    const preview = req.preview.length > MAX_PREVIEW ? `${req.preview.slice(0, MAX_PREVIEW)}…` : req.preview;
    parts.push(preview);
  }
  const choice = await vscode.window.showWarningMessage(
    `XR wants to run ${req.tool}.`,
    { modal: true, detail: parts.join("\n\n") },
    "Approve",
    "Deny",
  );
  return choice === "Approve";
}

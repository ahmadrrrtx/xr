/**
 * Status bar and tooltip text. Pure, so the wording and the truncation are tested.
 * Codicon syntax ($(shield)) is VS Code's own; nothing here is an emoji.
 */

import type { DaemonStatus } from "./shared/protocol";

export function shortModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const last = model.split("/").pop() ?? model;
  return last.length > 22 ? `${last.slice(0, 21)}…` : last;
}

export function money(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "$0.00";
  return usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

export function statusText(status: DaemonStatus, inlineOn: boolean): string {
  const base = "$(shield) XR";
  switch (status.state) {
    case "connected": {
      const parts = [base];
      const model = shortModel(status.model);
      if (model) parts.push(model);
      if (status.spendTodayUsd !== undefined) parts.push(`${money(status.spendTodayUsd)} today`);
      if (inlineOn) parts.push("inline");
      return parts.join(" · ");
    }
    case "connecting":
      return `${base} · connecting`;
    case "offline":
      return `${base} · offline`;
    case "unauthorized":
      return `${base} · token needed`;
  }
}

export function statusTooltip(status: DaemonStatus, inlineOn: boolean): string {
  const lines = ["XR"];
  switch (status.state) {
    case "connected":
      lines.push("Daemon connected" + (status.version ? ` (${status.version})` : ""));
      if (status.provider) lines.push(`Provider: ${status.provider}${status.model ? ` / ${status.model}` : ""}`);
      if (status.spendTodayUsd !== undefined) lines.push(`Spent today: ${money(status.spendTodayUsd)}`);
      break;
    case "connecting":
      lines.push("Connecting to the XR daemon…");
      break;
    case "offline":
      lines.push("XR is not running on this computer. Chat needs the daemon.");
      break;
    case "unauthorized":
      lines.push("The daemon needs a token. Run XR: Set daemon token.");
      break;
  }
  if (status.detail) lines.push(status.detail);
  lines.push(`Inline suggestions: ${inlineOn ? "on" : "off"}`);
  lines.push("Click for the XR menu.");
  return lines.join("\n");
}

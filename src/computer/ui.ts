/**
 * XR 3.1 — Computer Control UI
 *
 * Computer control capabilities with clear approval flows.
 *
 * Features:
 * - Capability overview (inspect, interact, execute, control, automate)
 * - Action approval with WHAT, WHY, SCOPE, RISK, ALLOW/DENY
 * - Dangerous actions never hidden
 * - Vision agent opt-in indicator
 *
 * Spec: XR_DESIGN_SYSTEM.md §10
 */

import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, xrRed, xrViolet } from "../../ui/theme.ts";
import { SYM } from "../../ui/theme.ts";
import { wrapAnsi, clipAnsi } from "../../ui/ansi.ts";
import { renderCompactAvatar } from "../../ui/avatar.ts";
import type { AvatarState } from "../../ui/avatar.ts";

// ── Capability Overview ────────────────────────────────────────────────────────

export type ComputerActionType = "inspect" | "interact" | "execute" | "control" | "automate";

export interface ComputerCapability {
  id: string;
  name: string;
  type: ComputerActionType;
  description: string;
  riskLevel: "none" | "low" | "medium" | "high";
  requiresApproval: boolean;
  platformSupport: string[];
  enabled: boolean;
}

/**
 * All computer control capabilities
 */
export const COMPUTER_CAPABILITIES: ComputerCapability[] = [
  // Inspect
  {
    id: "filesystem.read",
    name: "Read Files",
    type: "inspect",
    description: "View file contents and directory structure",
    riskLevel: "none",
    requiresApproval: false,
    platformSupport: ["linux", "macos", "windows"],
    enabled: true,
  },
  {
    id: "filesystem.list",
    name: "List Directories",
    type: "inspect",
    description: "Show files and folders in a directory",
    riskLevel: "none",
    requiresApproval: false,
    platformSupport: ["linux", "macos", "windows"],
    enabled: true,
  },
  {
    id: "filesystem.search",
    name: "Search Files",
    type: "inspect",
    description: "Find files by name or content",
    riskLevel: "none",
    requiresApproval: false,
    platformSupport: ["linux", "macos", "windows"],
    enabled: true,
  },
  {
    id: "system.info",
    name: "System Info",
    type: "inspect",
    description: "View system information (CPU, memory, etc.)",
    riskLevel: "none",
    requiresApproval: false,
    platformSupport: ["linux", "macos", "windows"],
    enabled: true,
  },

  // Interact
  {
    id: "clipboard.read",
    name: "Read Clipboard",
    type: "interact",
    description: "View clipboard contents",
    riskLevel: "low",
    requiresApproval: false,
    platformSupport: ["linux", "macos", "windows"],
    enabled: true,
  },
  {
    id: "clipboard.write",
    name: "Write Clipboard",
    type: "interact",
    description: "Set clipboard contents",
    riskLevel: "low",
    requiresApproval: false,
    platformSupport: ["linux", "macos", "windows"],
    enabled: true,
  },

  // Execute
  {
    id: "shell.execute",
    name: "Run Commands",
    type: "execute",
    description: "Execute terminal/shell commands",
    riskLevel: "medium",
    requiresApproval: true,
    platformSupport: ["linux", "macos", "windows"],
    enabled: true,
  },
  {
    id: "shell.pipe",
    name: "Pipe Input",
    type: "execute",
    description: "Send input to a running process",
    riskLevel: "medium",
    requiresApproval: true,
    platformSupport: ["linux", "macos"],
    enabled: false,
  },

  // Control
  {
    id: "window.focus",
    name: "Focus Window",
    type: "control",
    description: "Bring a window to the front",
    riskLevel: "low",
    requiresApproval: true,
    platformSupport: ["macos", "windows"],
    enabled: false,
  },
  {
    id: "window.list",
    name: "List Windows",
    type: "control",
    description: "Show open windows",
    riskLevel: "low",
    requiresApproval: false,
    platformSupport: ["macos", "windows"],
    enabled: false,
  },
  {
    id: "mouse.move",
    name: "Move Mouse",
    type: "control",
    description: "Move the cursor to a position",
    riskLevel: "medium",
    requiresApproval: true,
    platformSupport: ["linux", "macos", "windows"],
    enabled: false,
  },
  {
    id: "mouse.click",
    name: "Click Mouse",
    type: "control",
    description: "Click at a position",
    riskLevel: "medium",
    requiresApproval: true,
    platformSupport: ["linux", "macos", "windows"],
    enabled: false,
  },
  {
    id: "keyboard.type",
    name: "Type Keys",
    type: "control",
    description: "Send keystrokes to the active app",
    riskLevel: "high",
    requiresApproval: true,
    platformSupport: ["linux", "macos", "windows"],
    enabled: false,
  },

  // Automate
  {
    id: "automation.record",
    name: "Record Actions",
    type: "automate",
    description: "Record a sequence of actions to replay",
    riskLevel: "medium",
    requiresApproval: true,
    platformSupport: ["linux", "macos", "windows"],
    enabled: false,
  },
  {
    id: "automation.replay",
    name: "Replay Actions",
    type: "automate",
    description: "Replay a recorded sequence",
    riskLevel: "high",
    requiresApproval: true,
    platformSupport: ["linux", "macos", "windows"],
    enabled: false,
  },
];

// ── Capability Display ──────────────────────────────────────────────────────────

/**
 * Render computer capability card
 */
export function renderCapabilityCard(
  cap: ComputerCapability,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];
  const riskColor = {
    none: xrGreen,
    low: xrDim,
    medium: xrAmber,
    high: xrRed,
  }[cap.riskLevel];

  const riskIcon = {
    none: SYM.ok,
    low: SYM.info,
    medium: SYM.warn,
    high: SYM.error,
  }[cap.riskLevel];

  const approvalIcon = cap.requiresApproval ? SYM.warn : SYM.ok;
  const approvalText = cap.requiresApproval ? "Approval required" : "No approval needed";

  const statusIcon = cap.enabled ? SYM.ok : SYM.info;
  const statusText = cap.enabled ? "Enabled" : "Disabled";

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 52)) + "┐"));
  lines.push(xrCyan(`│ ${renderCompactAvatar(avatarState, "")} ${cap.name}`));
  lines.push(xrDim(`│ ${cap.description}`));

  lines.push("");
  lines.push(xrDim(`│ Type: ${cap.type}`));
  lines.push(xrDim(`│ Risk: ${riskIcon} ${riskColor(cap.riskLevel)}`));
  lines.push(xrDim(`│ Approval: ${approvalIcon} ${approvalText}`));
  lines.push(xrDim(`│ Status: ${statusIcon} ${statusText}`));

  if (cap.platformSupport.length > 0) {
    lines.push(xrDim(`│ Platforms: ${cap.platformSupport.join(", ")}`));
  }

  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 52)) + "┘"));

  return lines;
}

/**
 * Render capabilities grouped by type
 */
export function renderCapabilitiesOverview(
  capabilities: ComputerCapability[],
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  // Header with avatar
  const avatarLines = [
    `${renderCompactAvatar(avatarState, "XR")} ${xrBold("Computer Control")}`,
    xrDim("─".repeat(Math.min(width - 2, 48))),
  ];
  lines.push(...avatarLines);
  lines.push("");

  // Summary
  const enabled = capabilities.filter(c => c.enabled).length;
  const needsApproval = capabilities.filter(c => c.requiresApproval && c.enabled).length;
  const highRisk = capabilities.filter(c => c.riskLevel === "high" && c.enabled).length;

  lines.push(xrDim(`Total: ${capabilities.length} capabilities`));
  lines.push(xrDim(`Enabled: ${enabled}`));
  lines.push(xrDim(`Need approval: ${needsApproval}`));
  if (highRisk > 0) {
    lines.push(xrAmber(`High risk: ${highRisk} — use with caution`));
  }
  lines.push("");

  // Group by type
  const groups: Record<ComputerActionType, ComputerCapability[]> = {
    inspect: [],
    interact: [],
    execute: [],
    control: [],
    automate: [],
  };

  for (const cap of capabilities) {
    groups[cap.type].push(cap);
  }

  const typeLabels: Record<ComputerActionType, string> = {
    inspect: "Inspect (view only)",
    interact: "Interact (clipboard, etc.)",
    execute: "Execute (run commands)",
    control: "Control (windows, mouse, keyboard)",
    automate: "Automate (record/replay)",
  };

  for (const [type, caps] of Object.entries(groups)) {
    const enabledCount = caps.filter(c => c.enabled).length;
    if (enabledCount === 0 && caps.length > 0) {
      lines.push(xrDim(`${typeLabels[type]}: (all disabled)`));
    } else if (enabledCount > 0) {
      lines.push(xrBold(typeLabels[type]));
      for (const cap of caps) {
        if (cap.enabled) {
          lines.push(xrCyan(`  ✓ ${cap.name}`));
          lines.push(xrDim(`    ${cap.description}`));
          lines.push(xrDim(`    Risk: ${cap.riskLevel} · ${cap.requiresApproval ? "Approval: yes" : "Approval: no"}`));
        }
      }
      lines.push("");
    }
  }

  // Safety note
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push(xrAmber("⚠ Important:"));
  lines.push(xrDim("  Computer control can affect your system."));
  lines.push(xrDim("  Always review what XR wants to do before approving."));
  lines.push(xrDim("  High-risk actions need your explicit approval."));

  return lines;
}

// ── Action Approval Flow ────────────────────────────────────────────────────────

export interface ApprovalRequest {
  actionId: string;
  actionName: string;
  actionType: ComputerActionType;
  description: string;
  what: string;        // What will happen
  why: string;         // Why XR wants to do this
  scope: string;       // What's affected
  risk: string;        // Risk assessment
  riskLevel: "none" | "low" | "medium" | "high";
  platform: string;
  params?: Record<string, unknown>;
}

/**
 * Render action approval request
 */
export function renderApprovalRequest(
  req: ApprovalRequest,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  // Header
  const avatarLines = [
    `${renderCompactAvatar(avatarState, "XR")} ${xrBold("Action Needs Approval")}`,
    xrDim("─".repeat(Math.min(width - 2, 48))),
  ];
  lines.push(...avatarLines);
  lines.push("");

  // Action name
  lines.push(xrBold(`→ ${req.actionName}`));
  lines.push(xrDim(req.description));
  lines.push("");

  // What section
  lines.push(xrBold("WHAT will happen:"));
  lines.push(xrCyan(`  ${req.what}`));
  lines.push("");

  // Why section
  lines.push(xrBold("WHY XR wants to do this:"));
  lines.push(xrDim(`  ${req.why}`));
  lines.push("");

  // Scope section
  lines.push(xrBold("SCOPE (what's affected):"));
  lines.push(xrDim(`  ${req.scope}`));
  lines.push("");

  // Risk section
  const riskColor = {
    none: xrGreen,
    low: xrDim,
    medium: xrAmber,
    high: xrRed,
  }[req.riskLevel];

  const riskIcon = {
    none: SYM.ok,
    low: SYM.info,
    medium: SYM.warn,
    high: SYM.error,
  }[req.riskLevel];

  lines.push(xrBold("RISK ASSESSMENT:"));
  lines.push(xrDim(`  ${riskIcon} ${riskColor(req.riskLevel)} Risk level: ${req.riskLevel}`));
  lines.push(xrDim(`  ${req.risk}`));
  lines.push("");

  // Parameters (if any)
  if (req.params && Object.keys(req.params).length > 0) {
    lines.push(xrBold("PARAMETERS:"));
    for (const [key, value] of Object.entries(req.params)) {
      const valStr = typeof value === "string" ? value : JSON.stringify(value);
      const preview = valStr.length > 60 ? valStr.slice(0, 60) + "..." : valStr;
      lines.push(xrDim(`  ${key}: ${preview}`));
    }
    lines.push("");
  }

  // Platform
  lines.push(xrDim(`Platform: ${req.platform}`));
  lines.push("");

  // Decision buttons
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push("");
  lines.push(xrGreen("  [A] Allow Once    "));
  lines.push(xrAmber("  [S] Allow Session  "));
  lines.push(xrRed("  [D] Deny          "));
  lines.push("");
  lines.push(xrDim("  ? for more options (allow always, etc.)"));

  return lines;
}

/**
 * Render approval decision result
 */
export function renderApprovalResult(
  approved: boolean,
  req: ApprovalRequest,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  const icon = approved ? SYM.ok : SYM.error;
  const color = approved ? xrGreen : xrRed;
  const verb = approved ? "Allowed" : "Denied";

  lines.push("");
  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 44)) + "┐"));
  lines.push(color(`│ ${icon} ${verb}`));
  lines.push(color(`│ ${req.actionName}`));
  lines.push(xrDim("│"));

  if (approved) {
    lines.push(xrDim(`│ XR can now ${req.actionName.toLowerCase()}.`));
    lines.push(xrDim("│"));
    lines.push(xrDim(`│ ${SYM.info} This approval is for this action only.`));
    if (req.riskLevel === "high") {
      lines.push(xrAmber(`│ ${SYM.warn} Be cautious — this was a high-risk action.`));
    }
  } else {
    lines.push(xrDim(`│ XR will not ${req.actionName.toLowerCase()}.`));
    lines.push(xrDim("│"));
    lines.push(xrDim(`│ ${SYM.info} You can reconsider in Settings → Security.`));
  }

  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 44)) + "┘"));
  lines.push("");

  return lines;
}

// ── Vision Agent Status ─────────────────────────────────────────────────────────

export interface VisionAgentStatus {
  enabled: boolean;
  platformSupported: boolean;
  cameraAccess: boolean;
  description: string;
}

/**
 * Render vision agent status
 */
export function renderVisionAgentStatus(
  status: VisionAgentStatus,
  width: number,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("Vision Agent (Opt-in)"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 44))));
  lines.push("");

  if (!status.platformSupported) {
    lines.push(xrDim(`  ${SYM.info} Vision agent not supported on this platform.`));
    lines.push(xrDim(`  ${status.description}`));
    return lines;
  }

  const icon = status.enabled ? SYM.ok : SYM.info;
  const color = status.enabled ? xrGreen : xrDim;

  lines.push(xrDim(`  ${icon} ${color("Enabled:")} ${status.enabled}`));
  lines.push(xrDim(`  ${SYM.local} ${xrGreen("Camera access:")} ${status.cameraAccess}`));
  lines.push("");

  if (!status.enabled) {
    lines.push(xrDim("  Vision agent is optional."));
    lines.push(xrDim("  Enable in Settings → Computer Control → Vision"));
    lines.push(xrDim("  Requires camera access permission."));
  }

  lines.push("");
  lines.push(xrDim("  What it can do:"));
  lines.push(xrDim("    • See your screen (with permission)"));
  lines.push(xrDim("    • Understand visual context"));
  lines.push(xrDim("    • Help with visual tasks"));
  lines.push("");
  lines.push(xrAmber("  ⚠️ Privacy: Vision agent sees what you see."));
  lines.push(xrDim("     Only enable if you're comfortable with this."));

  return lines;
}

// ── Computer Control Settings ───────────────────────────────────────────────────

export interface ComputerControlSettings {
  filesystem: { enabled: boolean; requiresApproval: boolean };
  shell: { enabled: boolean; requiresApproval: boolean; timeout: number };
  clipboard: { enabled: boolean; requiresApproval: boolean };
  mouse: { enabled: boolean; requiresApproval: boolean };
  keyboard: { enabled: boolean; requiresApproval: boolean };
  windows: { enabled: boolean; requiresApproval: boolean };
  vision: { enabled: boolean; cameraAccess: boolean };
  automation: { enabled: boolean; requiresApproval: boolean };
}

/**
 * Render computer control settings
 */
export function renderComputerSettings(
  settings: ComputerControlSettings,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("Computer Control Settings"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push("");

  const sections = [
    {
      name: "Filesystem",
      enabled: settings.filesystem.enabled,
      approval: settings.filesystem.requiresApproval,
      desc: "Read files, list directories, search",
    },
    {
      name: "Shell Commands",
      enabled: settings.shell.enabled,
      approval: settings.shell.requiresApproval,
      desc: `Run commands (timeout: ${settings.shell.timeout}s)`,
    },
    {
      name: "Clipboard",
      enabled: settings.clipboard.enabled,
      approval: settings.clipboard.requiresApproval,
      desc: "Read and write clipboard",
    },
    {
      name: "Mouse Control",
      enabled: settings.mouse.enabled,
      approval: settings.mouse.requiresApproval,
      desc: "Move and click mouse",
    },
    {
      name: "Keyboard Control",
      enabled: settings.keyboard.enabled,
      approval: settings.keyboard.requiresApproval,
      desc: "Send keystrokes",
    },
    {
      name: "Window Control",
      enabled: settings.windows.enabled,
      approval: settings.windows.requiresApproval,
      desc: "Focus and list windows",
    },
    {
      name: "Vision Agent",
      enabled: settings.vision.enabled,
      approval: false,
      desc: "Visual understanding (camera access: " + settings.vision.cameraAccess + ")",
    },
    {
      name: "Automation",
      enabled: settings.automation.enabled,
      approval: settings.automation.requiresApproval,
      desc: "Record and replay actions",
    },
  ];

  for (const section of sections) {
    const icon = section.enabled ? SYM.ok : SYM.info;
    const color = section.enabled ? xrGreen : xrDim;

    lines.push(xrBold(`${icon} ${section.name}`));
    lines.push(xrDim(`  Enabled: ${section.enabled}`));
    lines.push(xrDim(`  ${section.desc}`));
    if (section.approval) {
      lines.push(xrAmber(`  Requires approval: Yes`));
    } else {
      lines.push(xrDim(`  Requires approval: No`));
    }
    lines.push("");
  }

  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push(xrDim("Press Enter to edit a setting, Esc to close."));

  return lines;
}

// ── Safety Banner ───────────────────────────────────────────────────────────────

/**
 * Render computer control safety banner (shown when capabilities are enabled)
 */
export function renderSafetyBanner(width: number): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(xrAmber("┌" + "─".repeat(Math.min(width - 2, 52)) + "┐"));
  lines.push(xrAmber(`│ ${SYM.warn} COMPUTER CONTROL ACTIVE`));
  lines.push(xrAmber(`│`));
  lines.push(xrAmber(`│ XR can now interact with your computer.`));
  lines.push(xrAmber(`│`));
  lines.push(xrAmber(`│ ${SYM.info} What's protected:`));
  lines.push(xrAmber(`│   • All actions need approval (except viewing)`));
  lines.push(xrAmber(`│   • High-risk actions are clearly marked`));
  lines.push(xrAmber(`│   • You can deny any action`));
  lines.push(xrAmber(`│   • Audit log records all actions`));
  lines.push(xrAmber(`│`));
  lines.push(xrAmber(`│ ${SYM.warn} Be careful what you approve.`)) ;
  lines.push(xrAmber(`└` + "─".repeat(Math.min(width - 2, 52)) + "┘"));
  lines.push("");

  return lines;
}

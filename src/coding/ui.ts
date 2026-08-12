/**
 * XR 3.1 — Coding Workspace UI
 *
 * VS Code-style coding environment with:
 * - File tree
 * - Editor concepts
 * - Tabs
 * - Terminal
 * - Agent panel
 * - Diffs
 * - Diagnostics
 * - Task execution
 * - Git awareness
 *
 * Built on actual runtime capabilities (src/tools/, etc.)
 *
 * Spec: XR_DESIGN_SYSTEM.md §11
 */

import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, xrRed, xrViolet } from "../../ui/theme.ts";
import { SYM } from "../../ui/theme.ts";
import { wrapAnsi, clipAnsi, padAnsi } from "../../ui/ansi.ts";
import { renderCompactAvatar } from "../../ui/avatar.ts";
import type { AvatarState } from "../../ui/avatar.ts";

// ── File Tree ──────────────────────────────────────────────────────────────────

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  size?: number;
  modified?: number;
  gitStatus?: "modified" | "added" | "deleted" | "untracked" | "unchanged";
  language?: string;
}

/**
 * Render a file tree
 */
export function renderFileTree(
  root: FileNode,
  width: number,
  avatarState: AvatarState,
  selectedPath?: string,
  maxDepth: number = 3,
): string[] {
  const lines: string[] = [];
  renderTreeNode(root, 0, width, avatarState, selectedPath, maxDepth, &lines);
  return lines;
}

function renderTreeNode(
  node: FileNode,
  depth: number,
  width: number,
  avatarState: AvatarState,
  selectedPath?: string,
  maxDepth: number,
  lines: string[],
): void {
  if (depth > maxDepth) return;

  const indent = "  ".repeat(depth);
  const isSelected = node.path === selectedPath;
  const isDir = node.type === "directory";

  // Git status icon
  const gitIcon = node.gitStatus === "modified" ? "✎"
    : node.gitStatus === "added" ? "✚"
    : node.gitStatus === "deleted" ? "✖"
    : node.gitStatus === "untracked" ? "?" 
    : isDir ? "⌑" : " ";

  // Language icon for files
  const langIcon = node.language ? getLanguageIcon(node.language) : "";

  // Selection highlight
  const prefix = isSelected ? xrCyan(`▸ ${indent}`) : `${indent}`;

  if (isDir) {
    lines.push(xrBold(`${prefix}${gitIcon} ${xrBold(node.name)}${langIcon ? " " + langIcon : ""}`));
    if (node.children) {
      for (const child of node.children) {
        renderTreeNode(child, depth + 1, width, avatarState, selectedPath, maxDepth, lines);
      }
    }
  } else {
    const sizeStr = node.size ? ` (${formatSize(node.size)})` : "";
    const modifiedStr = node.modified ? ` ${getAge(node.modified)}` : "";
    lines.push(`${prefix}${gitIcon} ${xrDim(node.name)}${langIcon ? " " + langIcon : ""}${xrDim(sizeStr)}${xrDim(modifiedStr)}`);
  }
}

/**
 * Get language icon
 */
function getLanguageIcon(language: string): string {
  const icons: Record<string, string> = {
    typescript: "TS",
    javascript: "JS",
    python: "Py",
    rust: "Rs",
    go: "Go",
    java: "Jv",
    cpp: "C++",
    c: "C",
    html: "H",
    css: "C",
    json: "{}",
    yaml: "Y",
    markdown: "M",
    sql: "DB",
    shell: "$",
    dockerfile: "DF",
  };
  return icons[language.toLowerCase()] ?? "";
}

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Get relative age
 */
function getAge(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}

// ── Editor ──────────────────────────────────────────────────────────────────────

export interface EditorState {
  filePath: string;
  content: string;
  cursorLine: number;
  cursorCol: number;
  scrollLine: number;
  dirty: boolean;
  language: string;
  diagnostics?: Diagnostic[];
}

export interface Diagnostic {
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  code?: string;
}

/**
 * Render editor view
 */
export function renderEditor(
  editor: EditorState,
  width: number,
  height: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  // Header
  const fileName = editor.filePath.split("/").pop() ?? editor.filePath;
  const lang = editor.language ? getLanguageIcon(editor.language) : "";
  const dirtyIcon = editor.dirty ? "●" : " ";

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 50)) + "┐"));
  lines.push(xrCyan(`│ ${renderCompactAvatar(avatarState, "")} ${dirtyIcon} ${fileName} ${lang}`));
  lines.push(xrDim(`│ ${editor.filePath}`));
  lines.push(xrDim("│"));

  // Diagnostic summary
  if (editor.diagnostics && editor.diagnostics.length > 0) {
    const errors = editor.diagnostics.filter(d => d.severity === "error").length;
    const warnings = editor.diagnostics.filter(d => d.severity === "warning").length;
    if (errors > 0 || warnings > 0) {
      lines.push(xrDim(`│ ${SYM.error} ${errors} error(s) ${SYM.warn} ${warnings} warning(s)`));
    }
  }

  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 50)) + "┘"));
  lines.push("");

  // Content with line numbers
  const contentLines = editor.content.split("\n");
  const visibleHeight = height - 6;
  const startLine = Math.max(0, editor.scrollLine);
  const endLine = Math.min(contentLines.length, startLine + visibleHeight);

  for (let i = startLine; i < endLine; i++) {
    const lineNum = (i + 1).toString().padStart(4);
    const isCurrentLine = i === editor.cursorLine;
    const prefix = isCurrentLine ? xrCyan(lineNum) : xrDim(lineNum);

    let lineContent = "";
    if (i < contentLines.length) {
      const line = contentLines[i];
      if (line.length > width - 8) {
        lineContent = xrDim(line.slice(0, width - 8)) + xrDim("...");
      } else {
        lineContent = xrDim(line);
      }
    }

    if (isCurrentLine) {
      lines.push(`${prefix} │ ${lineContent}`);
    } else {
      lines.push(`${prefix} │ ${lineContent}`);
    }
  }

  // Bottom bar
  lines.push("");
  const pos = `${editor.cursorLine + 1}:${editor.cursorCol + 1}`;
  const totalLines = contentLines.length;
  lines.push(xrDim(`Ln ${pos}    Col ${editor.cursorCol}    ${totalLines} lines    UTF-8    ${editor.language}`));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 50))));

  return lines;
}

// ── Tabs ────────────────────────────────────────────────────────────────────────

export interface Tab {
  id: string;
  filePath: string;
  label: string;
  dirty: boolean;
  language: string;
  order: number;
}

/**
 * Render tab bar
 */
export function renderTabs(
  tabs: Tab[],
  activeTabId: string,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  if (tabs.length === 0) {
    lines.push(xrDim("(no open files)"));
    return lines;
  }

  // Calculate how many tabs fit
  const tabWidth = 16;
  const fitCount = Math.max(1, Math.floor((width - 4) / tabWidth));
  const visibleTabs = tabs.slice(-fitCount);

  let tabLine = "";
  for (const tab of visibleTabs) {
    const isActive = tab.id === activeTabId;
    const closeIcon = isActive ? "●" : "○";
    const label = tab.label.length > 12 ? tab.label.slice(0, 10) + "..." : tab.label;
    const dirtyMark = tab.dirty ? "●" : "";

    if (isActive) {
      tabLine += xrCyan(`▸ ${label} ${dirtyMark} ${closeIcon}  `);
    } else {
      tabLine += xrDim(`  ${label} ${dirtyMark} ${closeIcon}  `);
    }
  }

  lines.push(clipAnsi(tabLine, width));
  lines.push("");

  return lines;
}

// ── Terminal ────────────────────────────────────────────────────────────────────

export interface TerminalState {
  lines: string[];
  prompt: string;
  input: string;
  cwd: string;
  history: string[];
  historyIndex: number;
}

/**
 * Render terminal
 */
export function renderTerminal(
  term: TerminalState,
  width: number,
  height: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  // Header
  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 40)) + "┐"));
  lines.push(xrGreen(`│ ${SYM.ok} Terminal  ${SYM.info} ${term.cwd}`));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 40)) + "┘"));
  lines.push("");

  // Terminal output
  const visibleHeight = height - 5;
  const startLine = Math.max(0, term.lines.length - visibleHeight);
  const visibleLines = term.lines.slice(startLine);

  for (const line of visibleLines) {
    lines.push(xrDim(line));
  }

  // Padding
  while (lines.length < height - 3) {
    lines.push("");
  }

  // Prompt
  const prompt = `${term.prompt} `;
  const input = term.input;

  lines.push(xrGreen(prompt) + xrWhite(input));
  lines.push("");
  lines.push(xrDim("Ctrl+C cancel  ·  Ctrl+L clear  ·  ↑↓ history"));

  return lines;
}

function xrWhite(text: string): string {
  return text; // Simplified - would use theme in real impl
}

// ── Agent Panel ─────────────────────────────────────────────────────────────────

export interface AgentPanelState {
  agentName: string;
  status: "idle" | "thinking" | "working" | "waiting" | "complete" | "error";
  currentTask: string;
  progress: number;
  messages: AgentMessage[];
}

export interface AgentMessage {
  role: "agent" | "tool" | "system" | "user";
  content: string;
  timestamp: number;
}

/**
 * Render agent panel
 */
export function renderAgentPanel(
  panel: AgentPanelState,
  width: number,
  height: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  // Header
  const statusIcon = {
    idle: SYM.info,
    thinking: "⟳",
    working: "⟳",
    waiting: SYM.warn,
    complete: SYM.ok,
    error: SYM.error,
  }[panel.status];

  const statusColor = {
    idle: xrDim,
    thinking: xrViolet,
    working: xrViolet,
    waiting: xrAmber,
    complete: xrGreen,
    error: xrRed,
  }[panel.status];

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 40)) + "┐"));
  lines.push(xrCyan(`│ ${renderCompactAvatar(avatarState, "")} ${panel.agentName}`));
  lines.push(xrDim(`│ ${statusIcon} ${statusColor(panel.status)} ${panel.status}`));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 40)) + "┘"));
  lines.push("");

  // Current task
  if (panel.currentTask) {
    lines.push(xrBold("Task:"));
    lines.push(xrDim(`  ${panel.currentTask}`));
    lines.push("");

    if (panel.status === "working" || panel.status === "thinking") {
      const barWidth = Math.min(30, width - 12);
      const filled = Math.round((panel.progress / 100) * barWidth);
      const bar = "█".repeat(filled) + "─".repeat(barWidth - filled);
      lines.push(xrDim(`  ${bar} ${panel.progress}%`));
      lines.push("");
    }
  }

  // Messages
  lines.push(xrBold("Activity:"));
  const recentMessages = panel.messages.slice(-10);
  for (const msg of recentMessages) {
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const prefix = msg.role === "tool" ? xrCyan("⚙")
      : msg.role === "system" ? xrDim("·")
      : msg.role === "user" ? xrGreen("You")
      : xrCyan("Agent");
    lines.push(xrDim(`  ${time} ${prefix}: ${msg.content}`));
  }

  if (panel.messages.length === 0) {
    lines.push(xrDim("  (no activity yet)"));
  }

  return lines;
}

// ── Diff View ───────────────────────────────────────────────────────────────────

export interface DiffLine {
  type: "unchanged" | "added" | "removed" | "modified";
  content: string;
  lineNumOld?: number;
  lineNumNew?: number;
}

export interface Diff {
  file: string;
  lines: DiffLine[];
  hunks: number;
}

/**
 * Render diff view
 */
export function renderDiff(
  diff: Diff,
  width: number,
  height: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  // Header
  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 50)) + "┐"));
  lines.push(xrCyan(`│ ${renderCompactAvatar(avatarState, "")} Diff: ${diff.file}`));
  lines.push(xrDim(`│ ${diff.hunks} hunk(s) · ${diff.lines.filter(l => l.type !== "unchanged").length} changes`));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 50)) + "┘"));
  lines.push("");

  // Legend
  lines.push(xrDim("Legend: " + xrGreen("+ added") + " " + xrRed("- removed") + " " + xrDim("  unchanged")));
  lines.push("");

  // Diff content
  const visibleHeight = height - 8;
  const startLine = 0;
  const endLine = Math.min(diff.lines.length, startLine + visibleHeight);

  for (let i = startLine; i < endLine; i++) {
    const line = diff.lines[i];
    const prefix = line.type === "added" ? xrGreen("+")
      : line.type === "removed" ? xrRed("-")
      : line.type === "modified" ? xrAmber("~")
      : xrDim(" ");

    const lineNum = line.lineNumNew
      ? `${line.lineNumNew}`.padStart(4)
      : line.lineNumOld
        ? `${line.lineNumOld}`.padStart(4)
        : "    ";

    lines.push(`${xrDim(lineNum)} ${prefix} ${xrDim(line.content)}`);
  }

  if (diff.lines.length > visibleHeight) {
    lines.push("");
    lines.push(xrDim(`... ${diff.lines.length - visibleHeight} more lines`));
  }

  return lines;
}

// ── Git Status ──────────────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

export interface GitFileStatus {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
}

/**
 * Render git status bar
 */
export function renderGitStatus(
  git: GitStatus,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  const branchIcon = SYM.info;
  const dirtyIcon = git.isDirty ? SYM.warn : SYM.ok;

  let statusLine = `${branchIcon} ${git.branch}`;

  if (git.ahead > 0) {
    statusLine += ` ${xrGreen("↑" + git.ahead)}`;
  }
  if (git.behind > 0) {
    statusLine += ` ${xrAmber("↓" + git.behind)}`;
  }
  if (git.isDirty) {
    statusLine += ` ${dirtyIcon} ${xrAmber("dirty")}`;
  }

  lines.push(clipAnsi(statusLine, width));

  if (git.files.length > 0 && git.isDirty) {
    const counts = {
      modified: git.files.filter(f => f.status === "modified").length,
      added: git.files.filter(f => f.status === "added").length,
      deleted: git.files.filter(f => f.status === "deleted").length,
      untracked: git.files.filter(f => f.status === "untracked").length,
    };

    const parts: string[] = [];
    if (counts.modified > 0) parts.push(`${counts.modified}M`);
    if (counts.added > 0) parts.push(`${counts.added}+`);
    if (counts.deleted > 0) parts.push(`${counts.deleted}-`);
    if (counts.untracked > 0) parts.push(`${counts.untracked}U`);

    lines.push(xrDim(parts.join(" ")));
  }

  return lines;
}

// ── Task Execution ──────────────────────────────────────────────────────────────

export interface TaskExecution {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error" | "cancelled";
  command: string;
  output: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Render task execution view
 */
export function renderTaskExecution(
  task: TaskExecution,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  const statusIcon = {
    pending: SYM.info,
    running: "⟳",
    success: SYM.ok,
    error: SYM.error,
    cancelled: SYM.warn,
  }[task.status];

  const statusColor = {
    pending: xrDim,
    running: xrCyan,
    success: xrGreen,
    error: xrRed,
    cancelled: xrAmber,
  }[task.status];

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 50)) + "┐"));
  lines.push(xrCyan(`│ ${renderCompactAvatar(avatarState, "")} ${statusIcon} ${task.name}`));
  lines.push(xrDim(`│ ${statusColor(task.status)} ${task.status}`));

  if (task.startTime) {
    lines.push(xrDim(`│ Started: ${new Date(task.startTime).toLocaleTimeString()}`));
  }
  if (task.endTime) {
    const duration = task.endTime - task.startTime;
    lines.push(xrDim(`│ Duration: ${duration}ms`));
  }

  lines.push(xrDim(`│ Command: ${task.command}`));

  if (task.output) {
    lines.push(xrDim("│"));
    lines.push(xrDim("│ Output:"));
    const outputLines = task.output.split("\n").slice(0, 5);
    for (const line of outputLines) {
      lines.push(xrDim(`│   ${line}`));
    }
    if (task.output.split("\n").length > 5) {
      lines.push(xrDim(`│   ... (${(task.output.split("\n").length - 5)} more lines)`));
    }
  }

  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 50)) + "┘"));

  return lines;
}

// ── Coding Workspace Layout ─────────────────────────────────────────────────────

export interface CodingWorkspaceLayout {
  fileTreeWidth: number;
  editorWidth: number;
  terminalHeight: number;
  agentPanelWidth: number;
  showFileTree: boolean;
  showTerminal: boolean;
  showAgentPanel: boolean;
  activeTabId: string;
  tabs: Tab[];
  fileTree: FileNode;
  editor: EditorState;
  terminal: TerminalState;
  agentPanel: AgentPanelState;
  gitStatus?: GitStatus;
}

/**
 * Render full coding workspace
 */
export function renderCodingWorkspace(
  layout: CodingWorkspaceLayout,
  cols: number,
  rows: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  // Top bar: tabs
  if (layout.tabs.length > 0) {
    const tabLines = renderTabs(layout.tabs, layout.activeTabId, cols, avatarState);
    lines.push(...tabLines);
    lines.push("");
  }

  // Main area split
  const hasSidebar = layout.showFileTree;
  const sidebarWidth = layout.fileTreeWidth;
  const mainWidth = cols - (hasSidebar ? sidebarWidth + 2 : 0);

  if (hasSidebar) {
    // File tree (left sidebar)
    const treeLines = renderFileTree(
      layout.fileTree,
      sidebarWidth,
      avatarState,
      layout.editor?.filePath,
      3,
    );
    for (const line of treeLines.slice(0, rows - 2)) {
      lines.push(padAnsi(line, sidebarWidth));
    }

    // Separator
    lines.push(xrDim("│"));

    // Main content
    const mainLines: string[] = [];

    // Editor
    if (layout.editor && layout.editor.filePath) {
      const editorLines = renderEditor(
        layout.editor,
        mainWidth,
        rows - 4 - (layout.showTerminal ? layout.terminalHeight + 2 : 0),
        avatarState,
      );
      mainLines.push(...editorLines);
    }

    // Terminal (bottom)
    if (layout.showTerminal && layout.terminal) {
      mainLines.push("");
      mainLines.push(xrDim("─".repeat(Math.min(mainWidth - 2, 40))));
      mainLines.push(xrGreen("Terminal"));
      mainLines.push(xrDim("─".repeat(Math.min(mainWidth - 2, 40))));
      const termLines = renderTerminal(
        layout.terminal,
        mainWidth,
        layout.terminalHeight,
        avatarState,
      );
      mainLines.push(...termLines);
    }

    // Pad to fill
    while (mainLines.length < rows) {
      mainLines.push("");
    }

    for (let i = 0; i < Math.min(rows, mainLines.length); i++) {
      const mainLine = mainLines[i] ?? "";
      lines.push(mainLine);
    }
  } else {
    // No sidebar - full width editor
    if (layout.editor && layout.editor.filePath) {
      const editorLines = renderEditor(
        layout.editor,
        cols,
        rows - 4 - (layout.showTerminal ? layout.terminalHeight + 2 : 0),
        avatarState,
      );
      lines.push(...editorLines);
    }

    if (layout.showTerminal && layout.terminal) {
      lines.push("");
      const termLines = renderTerminal(
        layout.terminal,
        cols,
        layout.terminalHeight,
        avatarState,
      );
      lines.push(...termLines);
    }
  }

  // Git status bar (bottom)
  if (layout.gitStatus) {
    lines.push("");
    const gitLines = renderGitStatus(layout.gitStatus, cols, avatarState);
    lines.push(...gitLines);
  }

  return lines.slice(0, rows);
}

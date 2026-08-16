/**
 * XR — Phase 07 · Trust-Handoff Policy (application-level).
 *
 * ── The threat ──────────────────────────────────────────────────────────────
 * TRUST HANDOFF: the agent stays inside its own security boundary, follows
 * every rule, but writes a configuration/executable file that some OTHER
 * trusted component later reads and executes OUTSIDE the sandbox — after the
 * agent's turn ends. The agent never runs the malicious code; a separate,
 * unsandboxed, trusted tool does. Examples (see docs/security/TRUST_HANDOFF.md):
 *   · .git/config / .git/hooks/*  → Git executes configured commands/hooks
 *                                    (GitPwned; CVE-2026-48124 Cursor Stop hook)
 *   · .claude/settings.local.json  → agent/IDE applies permissions + hooks
 *   · .vscode/tasks.json           → VS Code runs task shell commands
 *   · *.code-workspace             → VS Code applies folders/tasks/extensions
 *   · package.json scripts         → npm/yarn/pnpm run arbitrary shell
 *   · Makefile / Dockerfile / CI   → make/docker/CI runners execute
 *   · shell rc files (.bashrc …)   → sourced automatically by shells
 *
 * ── The contract ──────────────────────────────────────────────────────────
 * This module is the SINGLE classifier used by every write path (CLI
 * write_file tool today; any future daemon file-write route MUST import the
 * same `classifySensitiveWrite` so CLI and daemon cannot diverge — see
 * docs/security/TRUST_HANDOFF.md). It is PURE (no I/O) and deterministic.
 *
 * It does NOT silently block legitimate project files. It classifies a write
 * and, for anything sensitive/trust-handoff/executable, the caller REQUIRES
 * explicit human approval that shows the full action, the trusted component
 * that could consume the file, and the execution implication. A model's own
 * "approval" never counts as human approval (see files.ts wiring).
 *
 * This is an APPLICATION-LEVEL control. It is defense-in-depth, not a kernel
 * boundary: a determined process with filesystem write can still write these
 * paths; the guarantee is that XR's own tool will not do so without a visible,
 * explicit, informed human decision.
 */

import { sep } from "node:path";

export type TrustHandoffClass =
  | "SAFE"
  | "SENSITIVE"
  | "TRUST-HANDOFF"
  | "EXECUTABLE-CONFIG"
  | "REQUIRES-APPROVAL";

export interface TrustHandoffRule {
  /** Stable id for audit/telemetry. */
  id: string;
  /**
   * Matched against the normalized (lowercased, '/' separated) path AND its
   * basename. First match wins, so order rules most-specific first.
   */
  pattern: RegExp;
  classification: TrustHandoffClass;
  /** Human-readable reason shown in the approval prompt. */
  reason: string;
  /** The trusted external component that may later consume/execute the file. */
  trustedComponent: string;
  /** What executing/consuming the file can do, in plain language. */
  executionImplication: string;
}

/**
 * Centralized policy. Keep this the ONLY place trust-handoff path rules live;
 * do not duplicate regexes in tools or daemon routes.
 *
 * Order: most specific / most dangerous first. `.git/config` and `.git/hooks`
 * precede the broad `.git/` rule; `.claude/settings.local.json` precedes the
 * broad `.claude/` rule; etc.
 */
export const TRUST_HANDOFF_RULES: TrustHandoffRule[] = [
  {
    id: "git.config",
    pattern: /\.git\/config$/i,
    classification: "TRUST-HANDOFF",
    reason:
      "`.git/config` is read and executed by Git: it defines core.editor, core.pager, diff/merge/filter tools, core.fsmonitor and hooks that Git invokes with your user privileges the next time Git runs in this repo.",
    trustedComponent: "Git (git diff/show/commit, hooks, filters, fsmonitor)",
    executionImplication:
      "A malicious .git/config runs arbitrary commands as you when any Git operation is performed (GitPwned / CVE-2026-48124 class).",
  },
  {
    id: "git.hooks",
    pattern: /\.git\/hooks\//i,
    classification: "TRUST-HANDOFF",
    reason:
      "Files under `.git/hooks/` are executed automatically by Git on repo events (commit, push, checkout, receive, …) with no further approval.",
    trustedComponent: "Git hook runner",
    executionImplication: "Hooks run arbitrary code automatically the next time a matching Git event fires.",
  },
  {
    id: "git.any",
    pattern: /\.git\//i,
    classification: "TRUST-HANDOFF",
    reason:
      "Writing files inside `.git/` can redirect or corrupt repository internals (config, hooks, info/attributes with smudge/clean filters, refs). Git trusts these paths.",
    trustedComponent: "Git",
    executionImplication: "Malicious .git internals can execute code or exfiltrate/rewrite repository state on subsequent Git operations.",
  },
  {
    id: "claude.settings.local",
    pattern: /\.claude\/settings\.local\.json$/i,
    classification: "TRUST-HANDOFF",
    reason:
      "`.claude/settings.local.json` grants tool permissions, defines hooks, and injects environment that a separate agent/IDE applies automatically, outside XR's sandbox.",
    trustedComponent: "Claude Code / agentic IDE reading settings.local.json",
    executionImplication:
      "Can grant tool permissions, set auto-run hooks, and inject environment applied without your per-action approval (CVE-2026-48124 Stop-hook class).",
  },
  {
    id: "claude.settings",
    pattern: /\.claude\/settings\.json$/i,
    classification: "TRUST-HANDOFF",
    reason:
      "`.claude/settings.json` configures permissions, hooks and environment for agentic tooling that reads it outside XR's sandbox.",
    trustedComponent: "Claude Code / agentic IDE",
    executionImplication: "Can change tool permissions and register hooks executed automatically by the IDE/agent.",
  },
  {
    id: "vscode.tasks",
    pattern: /\.vscode\/tasks\.json$/i,
    classification: "TRUST-HANDOFF",
    reason:
      "`.vscode/tasks.json` defines tasks whose commands VS Code runs via its task runner, including automatically on certain triggers.",
    trustedComponent: "VS Code Task runner",
    executionImplication: "Task commands run as you when a task is invoked (outside XR's sandbox boundary).",
  },
  {
    id: "vscode.settings",
    pattern: /\.vscode\/settings\.json$/i,
    classification: "TRUST-HANDOFF",
    reason:
      "`.vscode/settings.json` can configure terminal environment, tasks, and extensions that execute when the workspace is opened.",
    trustedComponent: "VS Code / extensions",
    executionImplication: "Can set terminal env, register tasks, and enable extensions that run on open.",
  },
  {
    id: "vscode.launch",
    pattern: /\.vscode\/launch\.json$/i,
    classification: "TRUST-HANDOFF",
    reason: "`.vscode/launch.json` defines debug configurations whose preLaunch/ postDebug commands run automatically.",
    trustedComponent: "VS Code debugger",
    executionImplication: "Debug configurations can run shell commands before/after debugging.",
  },
  {
    id: "code-workspace",
    pattern: /\.code-workspace$/i,
    classification: "TRUST-HANDOFF",
    reason:
      "A `*.code-workspace` file defines folders, tasks, extensions and settings applied by VS Code when the workspace is opened.",
    trustedComponent: "VS Code workspace loader",
    executionImplication: "Can open folders, run tasks, and enable extensions with their settings on open.",
  },
  {
    id: "env",
    pattern: /\.env$/i,
    classification: "REQUIRES-APPROVAL",
    reason:
      "`.env` files commonly hold secrets/credentials. Writing one can override or leak secrets consumed by the application or other tooling.",
    trustedComponent: "Application / process that loads .env",
    executionImplication: "May override configuration or expose secrets when the app or a tool reads the file.",
  },
  {
    id: "package.json",
    pattern: /(^|\/)package\.json$/i,
    classification: "EXECUTABLE-CONFIG",
    reason:
      "`package.json` `scripts` run arbitrary shell commands via `npm run` / `yarn` / `pnpm`, and `prepare`/`postinstall` hooks run on install.",
    trustedComponent: "npm / yarn / pnpm; IDE; CI",
    executionImplication: "Defined scripts and lifecycle hooks execute shell commands when invoked or installed.",
  },
  {
    id: "makefile",
    pattern: /(^|\/)(makefile|gnumakefile)$/i,
    classification: "EXECUTABLE-CONFIG",
    reason: "Makefiles execute shell commands for their targets when `make` is invoked.",
    trustedComponent: "make",
    executionImplication: "Targets run shell commands when built.",
  },
  {
    id: "justfile",
    pattern: /(^|\/)justfile$/i,
    classification: "EXECUTABLE-CONFIG",
    reason: "Justfiles execute shell commands for their recipes when `just` is invoked.",
    trustedComponent: "just",
    executionImplication: "Recipes run shell commands when run.",
  },
  {
    id: "taskfile",
    pattern: /(^|\/)taskfile(\.yml|\.yaml)?$/i,
    classification: "EXECUTABLE-CONFIG",
    reason: "Taskfiles execute shell commands for their tasks when `task` is invoked.",
    trustedComponent: "Task (go-task)",
    executionImplication: "Tasks run shell commands when run.",
  },
  {
    id: "dockerfile",
    pattern: /(^|\/)dockerfile$/i,
    classification: "EXECUTABLE-CONFIG",
    reason: "A Dockerfile defines image build/run steps executed by the Docker daemon, which can mount host paths and run as root.",
    trustedComponent: "Docker daemon",
    executionImplication: "Build/runs images; can mount host directories and execute commands, potentially as root.",
  },
  {
    id: "docker-compose",
    pattern: /(^|\/)(docker-compose|compose)\.(yml|yaml)$/i,
    classification: "EXECUTABLE-CONFIG",
    reason: "Compose files define services, mounts and commands run by the Docker daemon.",
    trustedComponent: "Docker daemon (compose)",
    executionImplication: "Starts containers that can mount host paths and run commands, potentially as root.",
  },
  {
    id: "github-workflow",
    pattern: /\.github\/workflows\//i,
    classification: "EXECUTABLE-CONFIG",
    reason: "GitHub Actions workflow files execute arbitrary code in CI when triggered.",
    trustedComponent: "GitHub Actions runner",
    executionImplication: "Workflow steps run arbitrary code in CI on events (push, PR, etc.).",
  },
  {
    id: "gitlab-ci",
    pattern: /(^|\/)\.gitlab-ci\.yml$/i,
    classification: "EXECUTABLE-CONFIG",
    reason: ".gitlab-ci.yml defines pipelines executed by the GitLab CI runner.",
    trustedComponent: "GitLab CI runner",
    executionImplication: "Pipeline jobs run arbitrary code in CI when triggered.",
  },
  {
    id: "shell-rc",
    pattern: /(^|\/)(\.bashrc|\.bash_profile|\.bash_aliases|\.profile|\.zshrc|\.zprofile|\.zshenv)$/i,
    classification: "TRUST-HANDOFF",
    reason:
      "Shell rc files are sourced automatically by interactive shells and some tooling, running their contents on session start.",
    trustedComponent: "Interactive shell / tools that source rc files",
    executionImplication: "Commands in rc files execute automatically when a shell session starts.",
  },
];

export interface TrustHandoffVerdict {
  /** The path as supplied (normalized for matching). */
  path: string;
  classification: TrustHandoffClass;
  /** True when the write must surface an explicit, informed human approval. */
  requiresApproval: boolean;
  ruleId?: string;
  reason?: string;
  trustedComponent?: string;
  executionImplication?: string;
}

/** Normalize a path for matching: '/' separators, trimmed, no trailing slash. */
function normalize(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(new RegExp(`\\${sep}`, "g"), "/")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

function basenameOf(p: string): string {
  const norm = normalize(p);
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

/**
 * Classify a workspace write. `inputPath` may be relative to the workspace or
 * absolute; if `workspaceRoot` is given, an absolute path inside it is reduced
 * to its workspace-relative form before matching. Paths that escape the
 * workspace are still classified (their basename/structure may match), but the
 * caller is responsible for rejecting escapes separately (see files.ts safePath).
 */
export function classifySensitiveWrite(inputPath: string, workspaceRoot?: string): TrustHandoffVerdict {
  let rel = inputPath;
  if (workspaceRoot) {
    const wr = normalize(workspaceRoot);
    const norm = normalize(inputPath);
    if (norm.startsWith(wr + "/") || norm === wr) {
      rel = norm.slice(wr.length).replace(/^\/+/, "");
    }
  }
  const norm = normalize(rel);
  const base = basenameOf(norm);

  for (const rule of TRUST_HANDOFF_RULES) {
    if (rule.pattern.test(norm) || rule.pattern.test(base)) {
      const sensitive = rule.classification !== "SAFE";
      return {
        path: inputPath,
        classification: rule.classification,
        requiresApproval: sensitive,
        ruleId: rule.id,
        reason: rule.reason,
        trustedComponent: rule.trustedComponent,
        executionImplication: rule.executionImplication,
      };
    }
  }

  return { path: inputPath, classification: "SAFE", requiresApproval: false };
}

/** Convenience: true when the write is sensitive/trust-handoff/executable. */
export function requiresTrustHandoffApproval(inputPath: string, workspaceRoot?: string): boolean {
  return classifySensitiveWrite(inputPath, workspaceRoot).requiresApproval;
}

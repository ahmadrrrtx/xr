/**
 * Approval policy for the coder CLI.
 *
 * Every write, shell command and network call is decided here before it runs.
 * The engine's approval hook (`approve(req)`) calls `decide()`; the answer is
 * either final (allow/deny) or "ask", which the CLI resolves with a prompt.
 *
 * Precedence (first match wins):
 *   1. deny rules                      → deny   (never overridden)
 *   2. dangerous shell pattern         → ask    (never auto-approved, even in yolo)
 *   3. ask rules                       → ask
 *   4. read-only mode + mutating kind  → deny
 *   5. allow rules                     → allow
 *   6. session grant for the kind      → allow  (granted with `a`)
 *   7. mode: yolo → allow; auto-edit + edit → allow; read → allow
 *   8. otherwise                       → ask
 *
 * Non-interactive runs turn every "ask" into a deny and record it, so a script
 * can tell that the run was blocked rather than silently skipping work.
 */

export type ActionKind = "read" | "edit" | "shell" | "network" | "other";
export type ApprovalMode = "default" | "auto-edit" | "plan" | "yolo";

export function classifyTool(tool: string): ActionKind {
  switch (tool) {
    case "read_file":
    case "list_dir":
    case "search_code":
      return "read";
    case "write_file":
    case "patch_file":
    case "delete_file":
      return "edit";
    case "shell":
      return "shell";
    case "fetch_url":
    case "web_search":
      return "network";
    default:
      return "other";
  }
}

/** Shell patterns that always require a human, whatever the mode or rules. */
export const DANGEROUS_PATTERNS: ReadonlyArray<{ id: string; re: RegExp; why: string }> = [
  { id: "rm-recursive", re: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/, why: "recursive delete" },
  { id: "rm-force-root", re: /\brm\b[^\n;&|]*\s\/(\s|$|\*)/, why: "delete at filesystem root" },
  { id: "sudo", re: /(^|[;&|(]\s*|\s)sudo\b/, why: "privilege escalation (sudo)" },
  { id: "pipe-to-shell", re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, why: "pipes a download into a shell" },
  { id: "eval-remote", re: /\beval\b[^\n]*\$\((curl|wget)/, why: "evaluates remote content" },
  { id: "mkfs", re: /\bmkfs(\.\w+)?\b/, why: "formats a filesystem" },
  { id: "dd-device", re: /\bdd\b[^\n]*\bof=\/dev\//, why: "writes directly to a device" },
  { id: "device-redirect", re: />\s*\/dev\/(sd|nvme|disk|hd)/, why: "writes directly to a device" },
  { id: "fork-bomb", re: /:\(\)\s*\{\s*:\|:&\s*\};\s*:/, why: "fork bomb" },
  { id: "home-target", re: /(^|\s)(~|\$HOME|\$\{HOME\})(\/|\s|$)/, why: "targets the home directory" },
  { id: "recursive-perm", re: /\b(chmod|chown)\s+-R\b/, why: "recursive permission change" },
  { id: "git-force-push", re: /\bgit\s+push\b[^\n]*(--force\b|\s-f\b)/, why: "force push" },
  { id: "power", re: /\b(shutdown|reboot|halt|poweroff)\b/, why: "shuts down the machine" },
  { id: "secret-read", re: /(\.ssh\/|\.aws\/|\.netrc|\.git-credentials|id_rsa\b|\bprintenv\b|\benv\s*\|)/, why: "may expose secrets" },
];

export function dangerousReason(command: string): string | null {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.re.test(command)) return `${p.why} (${p.id})`;
  }
  return null;
}

export type RuleAction = "allow" | "ask" | "deny";

/** Rule: `shell`, `shell:npm test*`, `edit:src/*`, `network:https://docs.*`. */
export interface PermissionRules {
  allow?: string[];
  ask?: string[];
  deny?: string[];
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`);
}

export function ruleMatches(rule: string, kind: ActionKind, subject: string): boolean {
  const colon = rule.indexOf(":");
  const ruleKind = colon === -1 ? rule.trim() : rule.slice(0, colon).trim();
  const pattern = colon === -1 ? "*" : rule.slice(colon + 1).trim();
  if (ruleKind !== kind && ruleKind !== "*") return false;
  return globToRegExp(pattern).test(subject.trim());
}

export interface DecideInput {
  kind: ActionKind;
  tool: string;
  subject: string;
  mode: ApprovalMode;
  rules: PermissionRules;
  sessionGrants: ReadonlySet<ActionKind>;
  interactive: boolean;
}

export interface Decision {
  action: RuleAction;
  reason: string;
  /** Set when the decision was forced by the dangerous-command guard. */
  dangerous?: string;
}

const MUTATING: ReadonlySet<ActionKind> = new Set(["edit", "shell"]);

export function decide(input: DecideInput): Decision {
  const { kind, subject, mode, rules, sessionGrants } = input;

  const deny = (rules.deny ?? []).find((r) => ruleMatches(r, kind, subject));
  if (deny) return { action: "deny", reason: `deny rule "${deny}"` };

  const dangerous = kind === "shell" ? dangerousReason(subject) : null;
  if (dangerous) return { action: "ask", reason: `dangerous command: ${dangerous}`, dangerous };

  const ask = (rules.ask ?? []).find((r) => ruleMatches(r, kind, subject));
  if (ask) return { action: "ask", reason: `ask rule "${ask}"` };

  if (mode === "plan" && MUTATING.has(kind)) {
    return { action: "deny", reason: "read-only session: edits and commands are disabled" };
  }

  const allow = (rules.allow ?? []).find((r) => ruleMatches(r, kind, subject));
  if (allow) return { action: "allow", reason: `allow rule "${allow}"` };

  if (kind === "read") return { action: "allow", reason: "read-only action" };
  if (sessionGrants.has(kind)) return { action: "allow", reason: `granted for this session (${kind})` };
  if (mode === "yolo") return { action: "allow", reason: "auto-approve mode (--approve-all)" };
  if (mode === "auto-edit" && kind === "edit") return { action: "allow", reason: "auto-edit mode" };

  if (!input.interactive) return { action: "deny", reason: "no terminal to ask on (non-interactive run)" };
  return { action: "ask", reason: "requires approval" };
}

/** Parse `--tools read,search,edit,shell,web` (or engine tool names) into engine tool names. */
export const TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = {
  read: ["read_file", "list_dir"],
  search: ["search_code"],
  edit: ["write_file"],
  write: ["write_file"],
  shell: ["shell"],
  run: ["shell"],
  web: ["fetch_url", "web_search"],
  network: ["fetch_url", "web_search"],
};

export const READ_ONLY_TOOLS: readonly string[] = ["read_file", "list_dir", "search_code", "fetch_url"];
export const DEFAULT_TOOLS: readonly string[] = [
  "read_file",
  "list_dir",
  "search_code",
  "write_file",
  "shell",
  "fetch_url",
  "web_search",
];

export function resolveToolList(spec: string | undefined, base: readonly string[]): string[] {
  if (!spec) return [...base];
  const names = new Set<string>();
  for (const raw of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const group = TOOL_GROUPS[raw];
    if (group) group.forEach((n) => names.add(n));
    else names.add(raw);
  }
  // A restriction can narrow the base set but never widen it (e.g. -p stays read-only).
  return [...names].filter((n) => base.includes(n));
}

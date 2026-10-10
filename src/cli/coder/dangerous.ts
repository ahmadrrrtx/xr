/**
 * Phase 23 — dangerous-command detection for the coding agent.
 *
 * Two layers, both deliberate:
 *   1. The engine's shell tool already BLOCKS the worst patterns outright
 *      (src/security/guard.ts: recursive force delete, curl|sh). Those never reach
 *      the approval prompt at all.
 *   2. This module flags commands that are not blocked but are high-impact
 *      (privilege escalation, disk/format ops, secret reads, writes outside the
 *      project). A flagged command ALWAYS shows a prompt, even with --approve-all,
 *      and never gets a session-wide "always allow" grant.
 *
 * Matching is intentionally broad: a false positive costs one extra keypress; a
 * false negative bypasses the human. Keep it that way.
 */

export interface DangerVerdict {
  dangerous: boolean;
  /** Short, human label for the prompt (why it needs an explicit answer). */
  reason?: string;
}

const RULES: Array<{ re: RegExp; reason: string }> = [
  { re: /(^|[\s;&|(`])sudo(\s|$)/, reason: "runs with elevated privileges (sudo)" },
  { re: /(^|[\s;&|(`])(doas|su)\s/, reason: "runs with elevated privileges" },
  { re: /\bmkfs(\.\w+)?\b/, reason: "formats a filesystem (mkfs)" },
  { re: /\bdd\s+[^|;&\n]*\bof=\/dev\//, reason: "writes directly to a device (dd)" },
  { re: />\s*\/dev\/(sd|nvme|disk|hd)/, reason: "writes directly to a disk device" },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/, reason: "powers off or reboots the machine" },
  { re: /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?[0-7]*777\b/, reason: "makes files world-writable (chmod 777)" },
  { re: /\bchown\s+-R\b/, reason: "recursively changes ownership" },
  { re: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: "fork bomb" },
  { re: /\bgit\s+push\b[^\n]*--force\b|\bgit\s+push\b[^\n]*\s-f(\s|$)/, reason: "force-pushes to a remote" },
  { re: /\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-zA-Z]*f/, reason: "discards uncommitted work" },
  { re: /\b(cat|less|more|head|tail|grep|sed|awk|cp|scp|curl|base64)\b[^\n|;]*(\.env\b|id_rsa|id_ed25519|\.ssh\/|\.aws\/|\.netrc|\.git-credentials|credentials|\/etc\/shadow)/, reason: "reads or sends secrets or credential files" },
  { re: /\benv\b\s*($|\|)|\bprintenv\b|\bset\s*($|\|)/, reason: "prints the environment (may expose keys)" },
  { re: /(^|[\s;&|(])~(\/|\s|$)|\$HOME(\/|\s|$)/, reason: "targets the home directory" },
  { re: /(^|[\s;&|(])\/(etc|usr|bin|sbin|boot|var|System|Library|lib)(\/|\s|$)/, reason: "writes to a system directory" },
  { re: /\b(curl|wget)\b[^\n]*\|\s*(ba|z|da)?sh\b/, reason: "pipes a download into a shell" },
  { re: /\b(nc|ncat|netcat)\b[^\n]*\s-[a-zA-Z]*e\b/, reason: "opens a reverse shell" },
  { re: /\bcrontab\b|\blaunchctl\b|\bsystemctl\s+(enable|start|restart)\b/, reason: "changes scheduled or system services" },
];

/** Classify a shell command line. Pure. */
export function classifyShellCommand(cmd: string): DangerVerdict {
  const text = cmd.trim();
  if (!text) return { dangerous: false };
  for (const rule of RULES) {
    if (rule.re.test(text)) return { dangerous: true, reason: rule.reason };
  }
  // Recursive deletes (the engine blocks the worst; flag the rest for a human).
  if (/\brm\b[^\n;|&]*\s-[a-zA-Z]*[rR][a-zA-Z]*/.test(text) || /\brm\b[^\n;|&]*--recursive/.test(text)) {
    return { dangerous: true, reason: "recursive delete (rm -r)" };
  }
  return { dangerous: false };
}

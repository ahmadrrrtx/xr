/**
 * XR — security guard.
 *
 * Two deterministic layers the Injection Test Lab measures:
 *  1. scanUntrusted()  — flags injection signatures in untrusted content
 *                        (spotlighting/heuristics; cheap baseline hygiene).
 *  2. checkAction()    — the REAL guarantee: even if an injection slips past
 *                        scanning, deterministic policy blocks the dangerous
 *                        action (egress allow-list, destructive ops, secret
 *                        paths). Architecture > behavior. (TRD §4.)
 */

export interface ScanResult {
  flagged: boolean;
  signatures: string[];
}

const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "instruction_override", re: /ignore (all )?(previous|prior) instructions/i },
  { name: "unrestricted_mode", re: /unrestricted mode|disregard your (safety|rules)/i },
  { name: "fake_system", re: /^\s*system\s*:/im },
  { name: "prompt_extraction", re: /system prompt|repeat the text above|you are xr/i },
  { name: "pipe_to_shell", re: /\bcurl\b[^\n]*\|\s*(bash|sh)\b/i },
  { name: "rm_rf", re: /rm\s+-rf?\b/i },
  { name: "secret_path", re: /\.env\b|\.ssh\/|authorized_keys|credentials/i },
  { name: "exfil_url", re: /https?:\/\/[^\s]+\/(collect|exfil|steal|webhook)/i },
  { name: "mass_delete", re: /delete (every|all)\b.*\bfiles?\b|wipe (the )?(project|disk|drive)/i },
  { name: "leak_keys", re: /(api[_\s-]?keys?|secrets?)\b.*\b(append|post|send|reply|output)/i },
  // Zero-width / bidi / Unicode-tag smuggling. `u` flag so high-plane tag
  // chars (U+E0000–U+E007F) are matched by code point, not as surrogates.
  { name: "zero_width", re: /[\u200b-\u200f\u202a-\u202e\u2060-\u206f]|[\u{E0000}-\u{E007F}]/u },
];

/** Heuristic scan of untrusted text. */
export function scanUntrusted(text: string): ScanResult {
  const signatures: string[] = [];
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(text)) signatures.push(p.name);
  }
  return { flagged: signatures.length > 0, signatures };
}

export interface ActionCheck {
  tool: string;
  args: Record<string, unknown>;
}

export interface PolicyContext {
  /** Domains the agent may contact. Empty = none allowed. */
  egressAllowlist: string[];
  /** Tools that always require human approval. */
  requireApproval: string[];
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Deterministic action policy — the architectural guarantee.
 * This runs regardless of what the model "decided", so a successful injection
 * still can't do real damage.
 */
export function checkAction(action: ActionCheck, ctx: PolicyContext): PolicyDecision {
  const argsStr = JSON.stringify(action.args ?? {});

  // 1. Egress allow-list: any URL must be on the list.
  const urls = argsStr.match(/https?:\/\/([^\s"'\/]+)/gi) ?? [];
  for (const u of urls) {
    const host = u.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
    const ok = ctx.egressAllowlist.some(
      (d) => host === d.toLowerCase() || host.endsWith("." + d.toLowerCase()),
    );
    if (!ok) {
      return { allowed: false, reason: `egress blocked: ${host} not in allow-list` };
    }
  }

  // 2. Secret / sensitive paths are never auto-touchable.
  if (/\.env\b|\.ssh\/|authorized_keys|id_rsa|credentials/i.test(argsStr)) {
    return { allowed: false, reason: "blocked: access to a secret/credential path" };
  }

  // 3. Dangerous shell patterns blocked outright.
  if (action.tool === "shell" || /\bshell\b/i.test(action.tool)) {
    if (/rm\s+-rf?\b|curl[^\n]*\|\s*(bash|sh)|mkfs|dd\s+if=/i.test(argsStr)) {
      return { allowed: false, reason: "blocked: dangerous shell command" };
    }
  }

  return { allowed: true };
}

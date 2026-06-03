/**
 * XR — Injection Test Lab.
 * Runs the attack corpus through the deterministic defenses and reports a
 * real, publishable block-rate. This is the trust proof: `xr test --attacks`.
 */
import { ATTACK_CORPUS, type AttackCase } from "./attacks.ts";
import { scanUntrusted, checkAction, type PolicyContext } from "./guard.ts";

export interface AttackOutcome {
  id: string;
  category: string;
  description: string;
  blocked: boolean;
  by: string; // "scan:<sig>" | "policy:<reason>" | "—"
}

export interface LabReport {
  total: number;
  blocked: number;
  rate: number; // 0..1
  outcomes: AttackOutcome[];
}

/**
 * Derive the action an attack is trying to trigger, so the policy layer can
 * be tested (not just the scanner). Conservative extraction.
 */
function impliedAction(a: AttackCase): { tool: string; args: Record<string, unknown> } {
  const p = a.payload;
  const url = p.match(/https?:\/\/[^\s]+/i)?.[0];
  if (url) return { tool: "web_fetch", args: { url } };
  if (/\.env|\.ssh|authorized_keys|credentials/i.test(p))
    return { tool: "write_file", args: { path: "~/.ssh/authorized_keys" } };
  if (/curl[^\n]*\|\s*(bash|sh)|rm\s+-rf?/i.test(p))
    return { tool: "shell", args: { cmd: p } };
  return { tool: "noop", args: {} };
}

export function runLab(ctx?: Partial<PolicyContext>): LabReport {
  const policy: PolicyContext = {
    egressAllowlist: ctx?.egressAllowlist ?? [], // default: no external egress
    requireApproval: ctx?.requireApproval ?? ["write_file", "shell", "delete", "send"],
  };

  const outcomes: AttackOutcome[] = ATTACK_CORPUS.map((a) => {
    // Layer 1: scan the untrusted payload.
    const scan = scanUntrusted(a.payload);
    if (scan.flagged) {
      return { id: a.id, category: a.category, description: a.description, blocked: true, by: `scan:${scan.signatures[0]}` };
    }
    // Layer 2: even if scan missed it, would the policy block the action?
    const decision = checkAction(impliedAction(a), policy);
    if (!decision.allowed) {
      return { id: a.id, category: a.category, description: a.description, blocked: true, by: `policy:${decision.reason}` };
    }
    return { id: a.id, category: a.category, description: a.description, blocked: false, by: "—" };
  });

  const blocked = outcomes.filter((o) => o.blocked).length;
  return { total: outcomes.length, blocked, rate: blocked / outcomes.length, outcomes };
}

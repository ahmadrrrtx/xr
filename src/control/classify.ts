/**
 * XR v0.8 — Computer Control: pure risk classifier.
 *
 * Given an Action, return a RiskAssessment.  Pure function — no side effects,
 * no I/O.  This is the single source of truth for "is this safe to do
 * silently?" and is used by service.ts before every execution.
 *
 * Test this file aggressively — if it's wrong, safety is wrong.
 */

import type { Action, RiskAssessment } from "./types.ts";

/** URL/path patterns that are dangerous to "just open". */
const DANGEROUS_OPEN = [
  /^file:\/\//i,            // arbitrary local file opens (config dialogs, etc.)
  /\.(sh|bat|cmd|ps1|exe|app|dmg|pkg|msi|deb|rpm|appimage)(\?|$)/i, // executables
  /^javascript:/i,           // JS URIs in browsers
  /^data:/i,                 // data URIs can carry payloads
];

/** Key combos that mutate the system or are commonly destructive. */
const DESTRUCTIVE_KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ["enter"],                                    // form submit / send
  ["return"],
  ["cmd", "delete"], ["cmd", "backspace"],       // macOS delete file
  ["shift", "delete"],                          // Windows permanent delete
  ["ctrl", "shift", "delete"],                  // browser clear data
];

/** Heuristic: text that looks like a command someone might paste into a
 *  terminal.  "type" actions matching these get bumped to destructive so they
 *  always require confirmation. */
const TERMINAL_LIKE = [
  /^\s*(sudo|rm|mv|dd|chmod|chown|kill|shutdown|reboot|halt|format)\b/i,
  /\|\s*(sh|bash|zsh|pwsh|powershell)\b/i,
  /^\s*(curl|wget)\b.*\|\s*(sh|bash)/i,
  /^\s*(npm|pip|brew|apt|yum|dnf|choco)\s+(install|uninstall|remove)/i,
];

function keysEqual(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
  }
  return true;
}

export function classify(action: Action): RiskAssessment {
  switch (action.type) {
    case "move":
    case "scroll":
    case "focus":
      return { level: "safe", reason: `${action.type} is non-destructive`, reversible: true };

    case "app":
      return {
        level: "sensitive",
        reason: `launches application "${action.name}"`,
        reversible: true,
      };

    case "open": {
      const t = action.target.trim();
      if (DANGEROUS_OPEN.some((re) => re.test(t))) {
        return {
          level: "destructive",
          reason: `target "${t.slice(0, 80)}" can execute code or open arbitrary files`,
          reversible: false,
        };
      }
      return {
        level: "sensitive",
        reason: `opens "${t.slice(0, 80)}"`,
        reversible: true,
      };
    }

    case "type": {
      if (action.sensitive) {
        return {
          level: "destructive",
          reason: "typing a sensitive value (password / secret)",
          reversible: false,
        };
      }
      if (TERMINAL_LIKE.some((re) => re.test(action.text))) {
        return {
          level: "destructive",
          reason: "text resembles a shell command — refusing to type silently",
          reversible: false,
        };
      }
      return {
        level: "sensitive",
        reason: `types ${action.text.length} character(s) into the focused window`,
        reversible: true,
      };
    }

    case "click": {
      // Coordinate clicks are always sensitive — we have no way to know what
      // is under the cursor at execution time without a vision backend.
      return {
        level: "sensitive",
        reason: action.target
          ? `clicks UI element "${action.target}"`
          : `clicks at coordinates (${action.x ?? "?"}, ${action.y ?? "?"})`,
        reversible: false,
      };
    }

    case "key": {
      const keys = action.keys.map((k) => k.toLowerCase());
      if (DESTRUCTIVE_KEYS.some((d) => keysEqual(keys, d))) {
        return {
          level: "destructive",
          reason: `key combo ${keys.join("+")} commonly submits or deletes`,
          reversible: false,
        };
      }
      return {
        level: "sensitive",
        reason: `presses ${keys.join("+")}`,
        reversible: true,
      };
    }
  }
}

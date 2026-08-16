/**
 * XR — Phase 07 · Content-Hash Execution Integrity (APPLICATION-LEVEL).
 *
 * ── Principle ───────────────────────────────────────────────────────────────
 * CONTENT IS IDENTITY, NOT PATH. `/usr/bin/wget` is not trustworthy because of
 * its path; the actual bytes are. We identify an executed program by the
 * SHA-256 of its content (after symlink canonicalization) and compare it
 * against an allowlist of known-good hashes.
 *
 * ── What this layer CAN and CANNOT do (be honest) ───────────────────────────
 * ✅ Catches substitution of the on-disk binary the agent directly spawns
 *    (mv malicious /usr/bin/wget over the real one; a symlink/hardlink to a
 *    different binary; a PATH entry pointing elsewhere).
 * ✅ Covers the dynamic-linker bypass: `/lib/.../ld-linux-x86-64.so.2
 *    /usr/bin/wget` executes wget via mmap — we hash argv[1], NOT the linker.
 * ✅ Covers `/usr/bin/env prog` and interpreter wrappers (python -c, node -e,
 *    #! shebangs): the *real* program binary is hashed, the script is data.
 * ❌ Is NOT a kernel boundary. A process that already runs with your UID can
 *    re-exec a different binary, write then run it, or memory-load code; this
 *    gate sees only what XR explicitly spawns and only the first-hop binaries
 *    it can statically resolve. Full coverage needs kernel enforcement
 *    (BPF LSM exec/mmap) — see docs/security/CONTENT_HASH_EXECUTION.md.
 * ❌ Does not enumerate a shell command's full exec graph. `bash -lc "cmd"`
 *    can spawn anything; we hash the `bash` interpreter and best-effort the
 *    first direct token. Enumerating every transitive child requires tracing.
 *
 * ── Failure mode ────────────────────────────────────────────────────────────
 * Default mode is `audit` (record + allow) so existing workflows are NOT
 * broken. `enforce` (or `approval`) is opt-in via `XR_EXEC_INTEGRITY` or an
 * explicit override. Corrupt/unreadable allowlist → treated as empty
 * (fail-closed for `enforce`/`approval`: unknown hash is denied/escalated).
 */

import { createHash, randomBytes } from "node:crypto";
import { realpathSync, existsSync, statSync, writeFileSync, renameSync, chmodSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, isAbsolute, delimiter } from "node:path";
import { homedir } from "node:os";

export type ExecIntegrityMode = "off" | "audit" | "approval" | "enforce";

export interface ExecutableIdentity {
  /** The command token as written (argv[0] or a shell token). */
  token: string;
  /** Resolved absolute path, if the token resolved to a file. */
  resolved?: string;
  /** Symlink-canonicalized real path. */
  canonical?: string;
  /** SHA-256 hex of the file content (content is identity). */
  hash?: string;
  error?: string;
}

export interface ShellCommandIdentity {
  /** The interpreter actually executed (e.g. bash for `bash -lc`). */
  interpreter: ExecutableIdentity | null;
  /** Best-effort directly-invoked executables parsed from the command. */
  direct: ExecutableIdentity[];
}

export interface ExecIntegrityDecision {
  mode: ExecIntegrityMode;
  /** allow | audit | requireApproval | deny */
  decision: "allow" | "audit" | "requireApproval" | "deny";
  known: ExecutableIdentity[];
  unknown: ExecutableIdentity[];
  reasons: string[];
}

const INTERPRETERS = new Set([
  "bash", "sh", "dash", "zsh", "ksh", "fish",
  "python", "python3", "python2", "pypy", "pypy3",
  "node", "bun", "deno",
  "perl", "ruby", "php", "lua", "tclsh", "awk", "gawk",
  "pwsh", "powershell",
]);

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function isLinker(token: string): boolean {
  return /ld-linux|ld-so|ld\.so/.test(basenameOf(token)) || /ld-linux/.test(token);
}

/** SHA-256 of a file's content, or null if it cannot be read. */
export function hashFileContent(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Resolve a single command token to an identity: absolute-or-PATH lookup,
 * symlink canonicalization (so a symlink to an approved binary shares its
 * approved hash), and content SHA-256. Never throws.
 */
export function resolveToken(token: string, cwd: string): ExecutableIdentity {
  const id: ExecutableIdentity = { token };
  let candidate: string | undefined;
  if (isAbsolute(token)) {
    candidate = token;
  } else {
    const local = resolve(cwd, token);
    if (existsSync(local) && statSync(local).isFile()) candidate = local;
  }
  if (!candidate) {
    // Search PATH.
    const pathEnv = process.env.PATH ?? "";
    for (const dir of pathEnv.split(delimiter)) {
      const p = resolve(dir || ".", token);
      try {
        if (existsSync(p) && statSync(p).isFile()) {
          candidate = p;
          break;
        }
      } catch {
        /* keep searching */
      }
    }
  }
  if (!candidate) {
    id.error = "not found";
    return id;
  }
  try {
    const st = statSync(candidate);
    if (!st.isFile()) {
      id.error = "not a regular file";
      return id;
    }
    id.resolved = candidate;
    id.canonical = realpathSync(candidate);
    const h = hashFileContent(id.canonical);
    if (!h) {
      id.error = "unreadable";
      return id;
    }
    id.hash = h;
    return id;
  } catch (e) {
    id.error = (e as Error).message;
    return id;
  }
}

/**
 * Build an execution identity from an argv array (e.g. the process XR spawns).
 * Handles the documented bypasses:
 *   · ld-linux <binary>        → interpreter=linker, target=binary (mmap/execve)
 *   · /usr/bin/env <binary>    → target=binary
 *   · interpreter [-c|-e] …    → interpreter hashed; optional script-file arg hashed
 *   · plain <binary> [args]    → target=binary
 */
export function resolveArgvIdentity(argv: string[], cwd: string): ShellCommandIdentity {
  const out: ShellCommandIdentity = { interpreter: null, direct: [] };
  if (!argv.length) return out;

  const head = argv[0];
  const headBase = basenameOf(head);

  if (isLinker(head)) {
    // Dynamic linker: the executed program is argv[1].
    out.interpreter = resolveToken(head, cwd);
    if (argv[1]) out.direct.push(resolveToken(argv[1], cwd));
    return out;
  }
  if (headBase === "env") {
    // /usr/bin/env <prog> → the real program is argv[1].
    out.interpreter = resolveToken(head, cwd);
    if (argv[1] && !argv[1].startsWith("-")) out.direct.push(resolveToken(argv[1], cwd));
    return out;
  }
  if (INTERPRETERS.has(headBase) || /\.(py|js|ts|pl|rb|lua|php|sh)$/.test(headBase)) {
    out.interpreter = resolveToken(head, cwd);
    // A script file argument (first non-flag arg) is best-effort hashed.
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (a.startsWith("-")) continue;
      if (/\.(py|js|ts|pl|rb|lua|php|sh|bash|zsh)$/.test(a)) {
        out.direct.push(resolveToken(a, cwd));
      }
      break;
    }
    return out;
  }

  // Plain program.
  out.interpreter = resolveToken(head, cwd);
  return out;
}

/**
 * Best-effort identity for a shell command string (`bash -lc "<cmd>"`).
 * We always hash the interpreter (bash), and we extract the first whitespace-
 * separated token if it resolves to a real executable file. This is a HEURISTIC
 * for the common direct-invocation case; it does not model pipes, subshells,
 * command substitution, or PATH tricks (those require kernel tracing).
 */
export function resolveShellCommandIdentity(cmd: string, cwd: string, interpreter = "bash"): ShellCommandIdentity {
  const out: ShellCommandIdentity = { interpreter: resolveToken(interpreter, cwd), direct: [] };
  const trimmed = cmd.trim();
  if (!trimmed) return out;
  // Very small parser: first token, honoring simple single/double quotes.
  const m = trimmed.match(/^(['"]?)([^\s'"]+)\1/);
  const first = m ? m[2] : trimmed.split(/\s+/)[0];
  if (first && !first.startsWith("-") && !/^[|&;<>()$`\\]/.test(first)) {
    const id = resolveToken(first, cwd);
    if (id.hash) out.direct.push(id);
  }
  return out;
}

function resolveMode(explicit?: ExecIntegrityMode): ExecIntegrityMode {
  if (explicit) return explicit;
  const env = (process.env.XR_EXEC_INTEGRITY ?? "").toLowerCase();
  if (env === "off" || env === "audit" || env === "approval" || env === "enforce") return env;
  return "audit";
}

export function defaultExecAllowlistPath(): string {
  return `${process.env.XR_HOME ?? `${homedir()}/.xr`}/allowlist/exec-hashes.json`;
}

/**
 * Load the execution allowlist (set of known-good SHA-256 hashes).
 * Corruption / missing file → empty set (fail-closed for enforce/approval).
 */
export function loadExecAllowlist(path = defaultExecAllowlistPath()): Set<string> {
  const set = new Set<string>();
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { entries?: Array<{ hash?: string }> };
    for (const e of parsed.entries ?? []) {
      if (typeof e.hash === "string" && /^[a-f0-9]{64}$/i.test(e.hash)) set.add(e.hash.toLowerCase());
    }
  } catch {
    /* empty = fail-closed */
  }
  return set;
}

/**
 * Decide whether an identity may execute under the given mode + allowlist.
 * `allowlist` is a Set of known-good hashes (pass an explicit set in tests).
 */
export function decideExecIntegrity(
  identity: ShellCommandIdentity,
  opts: { mode?: ExecIntegrityMode; allowlist?: Set<string> } = {},
): ExecIntegrityDecision {
  const mode = resolveMode(opts.mode);
  const allowlist = opts.allowlist ?? new Set<string>();
  const all = [identity.interpreter, ...identity.direct].filter(Boolean) as ExecutableIdentity[];
  const known: ExecutableIdentity[] = [];
  const unknown: ExecutableIdentity[] = [];
  const reasons: string[] = [];

  for (const idn of all) {
    if (!idn.hash || idn.error) {
      unknown.push(idn);
      reasons.push(`unresolved executable ${idn.token}${idn.error ? ` (${idn.error})` : ""}`);
      continue;
    }
    if (allowlist.has(idn.hash.toLowerCase())) known.push(idn);
    else {
      unknown.push(idn);
      reasons.push(`unknown binary ${idn.canonical ?? idn.resolved ?? idn.token} sha256:${idn.hash.slice(0, 16)}…`);
    }
  }

  let decision: ExecIntegrityDecision["decision"] = "allow";
  if (mode === "off") decision = "allow";
  else if (mode === "audit") decision = "audit";
  else if (mode === "approval") decision = unknown.length ? "requireApproval" : "allow";
  else if (mode === "enforce") decision = unknown.length ? "deny" : "allow";

  return { mode, decision, known, unknown, reasons };
}

/**
 * Atomically append a hash to the allowlist (temp file + rename) and lock it
 * to 0600. Used by operators to enroll known-good binaries. Never overwrites.
 */
export function recordExecHash(hash: string, note: string, path = defaultExecAllowlistPath()): void {
  const dir = path.slice(0, path.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  let parsed: { version: number; entries: Array<{ hash: string; note: string; addedAt: number }> } = {
    version: 1,
    entries: [],
  };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
  } catch {
    /* start fresh */
  }
  if (parsed.entries.some((e) => e.hash.toLowerCase() === hash.toLowerCase())) return;
  parsed.entries.push({ hash: hash.toLowerCase(), note, addedAt: Date.now() });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(parsed, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path); // atomic on POSIX
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort */
  }
}

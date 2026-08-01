/**
 * XR Phase 4 · T1 — generate the bubblewrap seccomp blocklist policy files.
 *
 * Produces textual cBPF programs (the format bubblewrap reads via --seccomp)
 * that DENY a small set of kernel-dangerous syscalls and ALLOW everything
 * else. This is defense-in-depth ON TOP of the namespace sandbox: the primary
 * boundary is the user/mount/pid/net namespaces; the seccomp filter narrows
 * the syscall surface inside the sandbox (no mount/pivot_root/reboot/kexec/
 * ptrace, bpf, keyring, process-vm-read/write etc.), which matters because a
 * process inside a user namespace has namespace-local CAP_SYS_ADMIN.
 *
 * Blocklist (not allowlist): bash/coreutils/git/node/bun do not use the
 * blocked syscalls, so the filter does not break normal sandboxed work.
 *
 * Usage: bun run scripts/gen-seccomp.ts   (regenerates assets/seccomp/*.bpf)
 * The generated files are committed; CI fails if they drift from this script.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── syscall tables (numbers from Linux UAPI headers) ───────────────────────

/** Dangerous syscalls blocked inside the sandbox. x86_64 numbers. */
const X86_64_BLOCKLIST: Record<string, number> = {
  acct: 163, add_key: 248, bpf: 321, chroot: 161, create_module: 174,
  delete_module: 176, finit_module: 313, fsconfig: 431, fsmount: 432,
  fsopen: 430, fspick: 433, get_kernel_syms: 177, init_module: 175,
  ioperm: 173, iopl: 172, kcmp: 312, kexec_file_load: 320, kexec_load: 246,
  keyctl: 250, mount: 165, mount_setattr: 442, move_mount: 429,
  name_to_handle_at: 303, nfsservctl: 180, open_by_handle_at: 304,
  open_tree: 428, perf_event_open: 298, pivot_root: 155,
  process_vm_readv: 310, process_vm_writev: 311, ptrace: 101,
  query_module: 178, reboot: 169, request_key: 249, seccomp: 317,
  setdomainname: 171, sethostname: 170, setns: 308, swapoff: 168,
  swapon: 167, umount2: 166, unshare: 272, vhangup: 153, _sysctl: 156,
};

/**
 * Dangerous syscalls blocked inside the sandbox. AArch64 (asm-generic)
 * numbers. Kept to the set that is stable in the generic table; the x86_64
 * list is the fuller reference.
 */
const AARCH64_BLOCKLIST: Record<string, number> = {
  acct: 89, add_key: 217, bpf: 280, chroot: 161, delete_module: 106,
  finit_module: 273, fsconfig: 431, fsmount: 432, fsopen: 430, fspick: 433,
  init_module: 105, kcmp: 272, kexec_load: 104, keyctl: 219, mount: 40,
  mount_setattr: 442, move_mount: 429, name_to_handle_at: 264,
  open_by_handle_at: 103, open_tree: 428, perf_event_open: 241,
  pivot_root: 41, process_vm_readv: 270, process_vm_writev: 271,
  ptrace: 117, reboot: 142, request_key: 218, setns: 268, swapoff: 225,
  swapon: 224, umount2: 39, unshare: 97, vhangup: 58,
};

const BPF_LD_W_ABS = 0x20;        // BPF_LD | BPF_W | BPF_ABS
const BPF_JMP_JEQ_K = 0x15;       // BPF_JMP | BPF_JEQ | BPF_K
const BPF_RET_K = 0x06;           // BPF_RET | BPF_K
const SECCOMP_RET_ALLOW = 0x7fff0000;
const SECCOMP_RET_ERRNO_EPERM = 0x00050001; // SECCOMP_RET_ERRNO | EPERM

/**
 * Build the textual cBPF program:
 *
 *   line 0:            A = seccomp_data.nr (load word at offset 4)
 *   lines 1..N:        if A == blocked_i -> jump to the ERRNO return
 *   line N+1:          return ALLOW
 *   line N+2:          return ERRNO(EPERM)
 *
 * Format (bubblewrap --seccomp / libseccomp export):
 *   `<lineno>, <code>, <jt>, <jf>, <k>`
 */
export function buildBlocklistBpf(names: string[], numbers: number[]): string {
  const n = names.length;
  const allowLine = n + 1;
  const denyLine = n + 2;
  const lines: string[] = [];
  lines.push(`0, ${BPF_LD_W_ABS}, 0, 0, 4`);
  for (let i = 0; i < n; i++) {
    const line = i + 1;
    const jt = denyLine - (line + 1); // skip the remaining checks + ALLOW
    lines.push(`${line}, ${BPF_JMP_JEQ_K}, ${jt}, 0, ${numbers[i]}`);
  }
  lines.push(`${allowLine}, ${BPF_RET_K}, 0, 0, ${SECCOMP_RET_ALLOW}`);
  lines.push(`${denyLine}, ${BPF_RET_K}, 0, 0, ${SECCOMP_RET_ERRNO_EPERM}`);
  return `${lines.join("\n")}\n`;
}

export function renderPolicy(blocklist: Record<string, number>, arch: string): string {
  const names = Object.keys(blocklist).sort();
  const numbers = names.map((k) => blocklist[k]);
  const bpf = buildBlocklistBpf(names, numbers);
  // NOTE: no comment lines — bubblewrap's seccomp loader expects pure
  // `<line>, <code>, <jt>, <jf>, <k>` lines. The policy metadata (blocked
  // syscall names) is tracked in docs/security/SECURITY_MODEL.md.
  return bpf;
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "assets", "seccomp");

export function writePolicies(): string[] {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const [arch, table] of [
    ["x86_64", X86_64_BLOCKLIST],
    ["aarch64", AARCH64_BLOCKLIST],
  ] as const) {
    const path = join(outDir, `${arch}-blocklist.bpf`);
    writeFileSync(path, renderPolicy(table, arch));
    files.push(path);
  }
  return files;
}

if (import.meta.main) {
  for (const f of writePolicies()) {
    console.log(`wrote ${f}`);
  }
}

/**
 * Windows AppContainer mechanism for the Tier-2 OS sandbox (XR-LAUNCH-003, decision D3).
 *
 * EXPERIMENTAL and opt-in (`XR_OS_SANDBOX=experimental`); x64 only (bun:ffi).
 * With the flag unset, detection reports "unavailable" and the trust gate keeps
 * refusing Tier-2 work (fail closed). Not verified on Windows hardware by this
 * change; `os-sandbox.yml` runs the smoke on the windows-latest CI runner.
 *
 * Boundary:
 *   - the child runs in an AppContainer with NO capabilities: no network
 *     (internetClient/privateNetwork absent; loopback blocked), no access to
 *     the user profile or to any object whose ACL does not name the container
 *     SID or ALL APPLICATION PACKAGES (system dirs and Program Files stay
 *     readable, as for any packaged app);
 *   - the granted writable roots and a per-run scratch dir get one inheritable
 *     Modify ACE for the container SID (icacls, applied once per root);
 *   - the whole process tree sits in a Job object with KILL_ON_JOB_CLOSE, so a
 *     timeout kills every descendant;
 *   - stdio goes to files in the scratch dir (only those handles inherit).
 * Toolchains installed under the user profile (%LOCALAPPDATA%) are not visible.
 */
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dlopen, FFIType, ptr, toArrayBuffer, type Pointer } from "bun:ffi";

export const CONTAINER_NAME = "xr.trust.sandbox";

const C = {
  HRESULT_ALREADY_EXISTS: 0x800700b7,
  PROC_THREAD_ATTRIBUTE_HANDLE_LIST: 0x00020002,
  PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES: 0x00020009,
  EXTENDED_STARTUPINFO_PRESENT: 0x00080000,
  CREATE_SUSPENDED: 0x4,
  CREATE_NO_WINDOW: 0x08000000,
  CREATE_UNICODE_ENVIRONMENT: 0x400,
  STARTF_USESTDHANDLES: 0x100,
  JobObjectExtendedLimitInformation: 9,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: 0x2000,
  WAIT_OBJECT_0: 0,
  GENERIC_READ: 0x80000000,
  GENERIC_WRITE: 0x40000000,
  FILE_SHARE_READ_WRITE: 3,
  CREATE_ALWAYS: 2,
  OPEN_EXISTING: 3,
};

function load() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("appcontainer: win32 x64 only");
  const userenv = dlopen("userenv.dll", {
    CreateAppContainerProfile: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },
    DeriveAppContainerSidFromAppContainerName: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
  }).symbols;
  const advapi = dlopen("advapi32.dll", {
    ConvertSidToStringSidW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  }).symbols;
  const k32 = dlopen("kernel32.dll", {
    InitializeProcThreadAttributeList: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    UpdateProcThreadAttribute: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    DeleteProcThreadAttributeList: { args: [FFIType.ptr], returns: FFIType.void },
    CreateProcessW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64 },
    CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i64 },
    SetInformationJobObject: { args: [FFIType.i64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    AssignProcessToJobObject: { args: [FFIType.i64, FFIType.i64], returns: FFIType.i32 },
    TerminateJobObject: { args: [FFIType.i64, FFIType.u32], returns: FFIType.i32 },
    ResumeThread: { args: [FFIType.i64], returns: FFIType.u32 },
    WaitForSingleObject: { args: [FFIType.i64, FFIType.u32], returns: FFIType.u32 },
    GetExitCodeProcess: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.i64], returns: FFIType.i32 },
    LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr },
  }).symbols;
  return { userenv, advapi, k32 };
}
let lib: ReturnType<typeof load> | undefined;
const win = () => (lib ??= load());

const wide = (s: string) => Buffer.from(s + "\0", "utf16le");

/** Container SID (string form, "S-1-15-2-…"); the profile is created on first use. */
let cachedSid: { sid: Pointer; sidString: string } | undefined;
export function containerSid(): { sid: Pointer; sidString: string } {
  return (cachedSid ??= deriveSid()); // kept for the process lifetime (one small allocation)
}

function deriveSid(): { sid: Pointer; sidString: string } {
  const { userenv, advapi } = win();
  const out = Buffer.alloc(8);
  const name = wide(CONTAINER_NAME);
  let hr = userenv.CreateAppContainerProfile(ptr(name), ptr(wide("XR sandbox")), ptr(wide("XR Tier-2 command sandbox")), null, 0, ptr(out));
  if (hr >>> 0 === C.HRESULT_ALREADY_EXISTS) hr = userenv.DeriveAppContainerSidFromAppContainerName(ptr(name), ptr(out));
  if (hr >>> 0 !== 0) throw new Error(`appcontainer: profile/SID unavailable (0x${(hr >>> 0).toString(16)})`);
  const sid = Number(out.readBigUInt64LE(0)) as unknown as Pointer;
  const strOut = Buffer.alloc(8);
  if (!advapi.ConvertSidToStringSidW(sid, ptr(strOut))) throw new Error("appcontainer: SID conversion failed");
  const p = Number(strOut.readBigUInt64LE(0)) as unknown as Pointer;
  const sidString = readWide(p);
  win().k32.LocalFree(p);
  return { sid, sidString };
}

function readWide(p: Pointer): string {
  // NUL-terminated UTF-16 at p (a SID string is < 200 code units).
  const buf = Buffer.from(toArrayBuffer(p, 0, 512));
  let end = 0;
  while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2;
  return buf.subarray(0, end).toString("utf16le");
}

const granted = new Set<string>();
/** One inheritable Modify ACE for the container SID on `dir` (idempotent per process). */
export function grantContainerAccess(dir: string, sidString: string): void {
  const key = `${sidString}|${dir.toLowerCase()}`;
  if (granted.has(key)) return;
  const r = spawnSync("icacls", [dir, "/grant", `*${sidString}:(OI)(CI)M`, "/Q"], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`appcontainer: could not grant the sandbox access to ${dir}`);
  granted.add(key);
}

/** MSVCRT command-line quoting for one argument. */
export function quoteWindowsArg(a: string): string {
  if (a.length > 0 && !/[\s"]/.test(a)) return a;
  let out = '"';
  let backslashes = 0;
  for (const ch of a) {
    if (ch === "\\") { backslashes++; continue; }
    if (ch === '"') { out += "\\".repeat(backslashes * 2 + 1) + '"'; backslashes = 0; continue; }
    out += "\\".repeat(backslashes) + ch;
    backslashes = 0;
  }
  return out + "\\".repeat(backslashes * 2) + '"';
}

export interface AppContainerRun {
  argv: readonly string[];
  cwd: string;
  env: Record<string, string>;
  writableRoots: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
  stdin?: string;
}

export interface AppContainerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
  spawnError?: string;
}

/** Run one command inside the AppContainer; resolves when the job ends or times out. */
export async function runInAppContainer(run: AppContainerRun): Promise<AppContainerResult> {
  const started = Date.now();
  const { k32 } = win();
  const { sid, sidString } = containerSid();
  const scratch = mkdtempSync(join(tmpdir(), "xr-ac-"));
  const handles: number[] = [];
  let attrList: Buffer | null = null;
  try {
    grantContainerAccess(scratch, sidString);
    for (const r of run.writableRoots) grantContainerAccess(r, sidString);
    writeFileSync(join(scratch, "stdin"), run.stdin ?? "");
    closeSync(openSync(join(scratch, "stdout"), "w"));
    closeSync(openSync(join(scratch, "stderr"), "w"));

    // Inheritable handles for stdio (SECURITY_ATTRIBUTES.bInheritHandle = TRUE).
    const sa = Buffer.alloc(24);
    sa.writeUInt32LE(24, 0);
    sa.writeInt32LE(1, 16);
    const open = (name: string, write: boolean) => {
      const h = Number(k32.CreateFileW(ptr(wide(join(scratch, name))), write ? C.GENERIC_WRITE : C.GENERIC_READ, C.FILE_SHARE_READ_WRITE, ptr(sa), write ? C.CREATE_ALWAYS : C.OPEN_EXISTING, 0x80, null));
      if (h === -1 || h === 0) throw new Error("appcontainer: stdio file");
      handles.push(h);
      return h;
    };
    const hIn = open("stdin", false), hOut = open("stdout", true), hErr = open("stderr", true);

    // Attribute list: SECURITY_CAPABILITIES (no capabilities) + HANDLE_LIST (only stdio inherits).
    const sizeBuf = Buffer.alloc(8);
    k32.InitializeProcThreadAttributeList(null, 2, 0, ptr(sizeBuf));
    attrList = Buffer.alloc(Number(sizeBuf.readBigUInt64LE(0)));
    if (!k32.InitializeProcThreadAttributeList(ptr(attrList), 2, 0, ptr(sizeBuf))) throw new Error("appcontainer: attribute list");
    const caps = Buffer.alloc(24); // SECURITY_CAPABILITIES { PSID AppContainerSid; PSID_AND_ATTRIBUTES Capabilities; DWORD CapabilityCount; DWORD Reserved; }
    caps.writeBigUInt64LE(BigInt(sid as unknown as number), 0);
    if (!k32.UpdateProcThreadAttribute(ptr(attrList), 0, C.PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, ptr(caps), 24, null, null)) throw new Error("appcontainer: security capabilities");
    const hl = Buffer.alloc(24);
    hl.writeBigUInt64LE(BigInt(hIn), 0); hl.writeBigUInt64LE(BigInt(hOut), 8); hl.writeBigUInt64LE(BigInt(hErr), 16);
    if (!k32.UpdateProcThreadAttribute(ptr(attrList), 0, C.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, ptr(hl), 24, null, null)) throw new Error("appcontainer: handle list");

    // STARTUPINFOEXW (x64: STARTUPINFOW 104 bytes + lpAttributeList).
    const si = Buffer.alloc(112);
    si.writeUInt32LE(112, 0);
    si.writeUInt32LE(C.STARTF_USESTDHANDLES, 60);
    si.writeBigUInt64LE(BigInt(hIn), 80); si.writeBigUInt64LE(BigInt(hOut), 88); si.writeBigUInt64LE(BigInt(hErr), 96);
    si.writeBigUInt64LE(BigInt(ptr(attrList)), 104);
    const pi = Buffer.alloc(24); // PROCESS_INFORMATION

    const env = { ...run.env, TEMP: scratch, TMP: scratch, USERPROFILE: scratch, HOME: scratch };
    const envBlock = Buffer.from(Object.entries(env).map(([k, v]) => `${k}=${v}\0`).join("") + "\0", "utf16le");
    const cmdline = wide(run.argv.map(quoteWindowsArg).join(" "));
    const ok = k32.CreateProcessW(null, ptr(cmdline), null, null, 1,
      C.EXTENDED_STARTUPINFO_PRESENT | C.CREATE_SUSPENDED | C.CREATE_NO_WINDOW | C.CREATE_UNICODE_ENVIRONMENT,
      ptr(envBlock), ptr(wide(run.cwd)), ptr(si), ptr(pi));
    if (!ok) return { exitCode: null, stdout: "", stderr: "", timedOut: false, outputTruncated: false, durationMs: Date.now() - started, spawnError: "appcontainer: CreateProcessW failed" };
    const hProcess = Number(pi.readBigUInt64LE(0)), hThread = Number(pi.readBigUInt64LE(8));
    handles.push(hProcess, hThread);

    const job = Number(k32.CreateJobObjectW(null, null));
    if (!job) throw new Error("appcontainer: job object");
    handles.push(job);
    const limits = Buffer.alloc(144); // JOBOBJECT_EXTENDED_LIMIT_INFORMATION (x64)
    limits.writeUInt32LE(C.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 16);
    if (!k32.SetInformationJobObject(job, C.JobObjectExtendedLimitInformation, ptr(limits), 144) || !k32.AssignProcessToJobObject(job, hProcess)) {
      k32.TerminateJobObject(job, 1);
      throw new Error("appcontainer: job assignment");
    }
    k32.ResumeThread(hThread);

    let timedOut = false;
    for (;;) {
      if (k32.WaitForSingleObject(hProcess, 0) === C.WAIT_OBJECT_0) break;
      if (Date.now() - started > run.timeoutMs) {
        timedOut = true;
        k32.TerminateJobObject(job, 124);
        k32.WaitForSingleObject(hProcess, 5000);
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    const code = Buffer.alloc(4);
    k32.GetExitCodeProcess(hProcess, ptr(code));
    k32.TerminateJobObject(job, 1); // descendants that outlived the root
    for (const h of handles.splice(0)) k32.CloseHandle(h);
    const read = (name: string) => readFileSync(join(scratch, name));
    const out = read("stdout"), err = read("stderr");
    const truncated = out.length + err.length > run.maxOutputBytes;
    return {
      exitCode: timedOut ? null : code.readInt32LE(0),
      stdout: out.subarray(0, run.maxOutputBytes).toString("utf8"),
      stderr: err.subarray(0, Math.max(0, run.maxOutputBytes - out.length)).toString("utf8"),
      timedOut,
      outputTruncated: truncated,
      durationMs: Date.now() - started,
    };
  } finally {
    for (const h of handles) k32.CloseHandle(h);
    if (attrList) k32.DeleteProcThreadAttributeList(ptr(attrList));
    rmSync(scratch, { recursive: true, force: true });
  }
}

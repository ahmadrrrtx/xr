/**
 * XR Phase 1 · T10 — Real uninstall.
 *
 *   xr uninstall --keep-data   remove launcher, install dir, PATH entries;
 *                              keep the data home (~/.xr by default)
 *   xr uninstall --purge       additionally remove the data home (config,
 *                              databases, vault, memory, backups)
 *
 * Filesystem effects are asserted per mode by
 * `test/reliability/update-uninstall.test.ts`. Deletion is user-confirmed
 * (unless --yes) and never deletes the checkout the running binary lives in.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

export type UninstallMode = "keep-data" | "purge";

export interface UninstallPaths {
  /** The package install dir (install.sh `$TARGET_DIR`). */
  installDir: string;
  /** The data home (config.ts XR_HOME — config, DBs, vault, memory). */
  dataHome: string;
  /** Launcher path (install.sh writes ~/.local/bin/xr). */
  launcher: string;
  /** Shell rc files that may contain the "XR launcher" PATH block. */
  rcFiles: string[];
}

/** Resolve the paths uninstall operates on (pure, testable). */
export function resolveUninstallPaths(env: NodeJS.ProcessEnv = process.env): UninstallPaths {
  const home = env.HOME ?? homedir();
  // install.sh: TARGET_DIR="${XR_HOME:-$HOME/.xr-agent}"
  const installDir = env.XR_HOME && env.XR_HOME.length > 0 ? env.XR_HOME : join(home, ".xr-agent");
  // config.ts: XR_HOME = process.env.XR_HOME ?? join(homedir(), ".xr")
  const dataHome = env.XR_HOME && env.XR_HOME.length > 0 ? env.XR_HOME : join(home, ".xr");
  const launcher = join(home, ".local", "bin", process.platform === "win32" ? "xr.cmd" : "xr");
  return {
    installDir,
    dataHome,
    launcher,
    rcFiles: [join(home, ".bashrc"), join(home, ".zshrc"), join(home, ".profile")],
  };
}

/** True when the target is the checkout the running code lives in. */
export function isRunningCheckout(target: string, packageRoot: string): boolean {
  if (!target || !packageRoot) return false;
  const a = target.replace(/[\\/]+$/, "");
  const b = packageRoot.replace(/[\\/]+$/, "");
  return a === b;
}

/**
 * Launch audit XR-LAUNCH-006 — the PATH block XR writes into shell rc files.
 *
 * Current installers write a marker-delimited block; every installer before
 * that appended exactly LEGACY_RC_BLOCK. Uninstall removes ONLY those exact
 * bytes. The old implementation dropped every line containing
 * `.local/bin:$PATH`, which deleted the body of Ubuntu's default ~/.profile
 * `if [ -d "$HOME/.local/bin" ] ; then PATH="$HOME/.local/bin:$PATH"; fi`
 * stanza and left a shell syntax error behind.
 */
export const RC_BLOCK_BEGIN = "# >>> XR launcher >>> (added by the XR installer; removed by `xr uninstall`)";
export const RC_BLOCK_END = "# <<< XR launcher <<<";
export const RC_BLOCK_BODY = 'export PATH="$HOME/.local/bin:$PATH"';
/** Exactly what install.sh appends (leading newline included). Keep in sync with install.sh. */
export const RC_BLOCK = `\n${RC_BLOCK_BEGIN}\n${RC_BLOCK_BODY}\n${RC_BLOCK_END}\n`;
/** Exactly what every pre-1.0.1 install.sh appended: printf '\n# XR launcher\nexport PATH=...\n'. */
export const LEGACY_RC_BLOCK = `\n# XR launcher\n${RC_BLOCK_BODY}\n`;

/**
 * Remove XR's PATH block(s) from rc-file content. Pure. Returns the new
 * content (unchanged when there is nothing of XR's in it).
 *
 * Order of preference, each removing only bytes XR wrote:
 *  1. the exact current block (with its leading newline);
 *  2. a marker-delimited block whose body the user edited — BEGIN..END lines;
 *  3. the exact legacy two-line block (with its leading newline), or the same
 *     two lines at the very start of the file.
 * Anything else — including unrelated `.local/bin` PATH lines — is left alone.
 */
export function stripXrRcBlock(content: string): string {
  let out = content;
  // CRLF files: operate on the same bytes with \r\n.
  const eol = out.includes("\r\n") ? "\r\n" : "\n";
  const norm = (s: string) => (eol === "\n" ? s : s.replace(/\n/g, "\r\n"));

  for (;;) {
    const exact = norm(RC_BLOCK);
    const i = out.indexOf(exact);
    if (i === -1) break;
    out = out.slice(0, i) + out.slice(i + exact.length);
  }
  // Edited marker block: remove from the BEGIN line through the END line.
  for (;;) {
    const b = out.indexOf(RC_BLOCK_BEGIN);
    if (b === -1) break;
    const e = out.indexOf(RC_BLOCK_END, b);
    if (e === -1) break; // unterminated: do not guess, leave it
    let start = out.lastIndexOf("\n", b - 1) + 1; // beginning of the BEGIN line
    let end = out.indexOf("\n", e);
    end = end === -1 ? out.length : end + 1;
    // Also take the single blank line the installer put in front, if present.
    if (start >= eol.length && out.slice(start - eol.length, start) === eol) start -= eol.length;
    out = out.slice(0, start) + out.slice(end);
  }
  for (;;) {
    const legacy = norm(LEGACY_RC_BLOCK);
    const i = out.indexOf(legacy);
    if (i !== -1) {
      out = out.slice(0, i) + out.slice(i + legacy.length);
      continue;
    }
    const atStart = legacy.slice(eol.length);
    if (out.startsWith(atStart)) {
      out = out.slice(atStart.length);
      continue;
    }
    break;
  }
  return out;
}

/** Remove XR's PATH block from shell rc files. Returns the files touched. */
export function removePathEntries(paths: UninstallPaths): string[] {
  const touched: string[] = [];
  for (const rc of paths.rcFiles) {
    if (!existsSync(rc)) continue;
    try {
      const before = readFileSync(rc, "utf8");
      const after = stripXrRcBlock(before);
      if (after !== before) {
        writeFileSync(rc, after, "utf8");
        touched.push(rc);
      }
    } catch {
      /* best-effort */
    }
  }
  return touched;
}

/** install.ps1 appends `<installDir>\bin-local` to the HKCU user Path; drop exactly that entry. Pure. */
export function stripUserPathEntry(userPath: string, entry: string): string {
  const norm = (p: string) => p.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return userPath.split(";").filter((p) => norm(p) !== norm(entry)).join(";");
}

type PsRun = (script: string, env?: Record<string, string>) => { status: number | null; stdout: string };
const runPs: PsRun = (script, env = {}) => {
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 30_000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "" };
};

/** Windows: remove install.ps1's user-Path entry. Never writes back a Path it failed to read. */
export function removeWindowsUserPath(paths: UninstallPaths, ps: PsRun = runPs, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return false;
  const read = ps("[Environment]::GetEnvironmentVariable('Path','User')");
  if (read.status !== 0) return false;
  const before = read.stdout.replace(/\r?\n$/, "");
  const after = stripUserPathEntry(before, join(paths.installDir, "bin-local"));
  if (after === before) return false;
  return ps("[Environment]::SetEnvironmentVariable('Path', $env:XR_UNINSTALL_PATH, 'User')", { XR_UNINSTALL_PATH: after }).status === 0;
}

/** Windows locks the running xr.exe inside the install dir: finish the removal after this process exits. */
function scheduleWindowsRemoval(dir: string): boolean {
  try {
    spawn("cmd.exe", ["/d", "/c", `ping -n 4 127.0.0.1 >nul & rmdir /s /q "${dir}"`], { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Remove the launcher + the package install dir (never the running checkout). */
export function removeInstallation(
  paths: UninstallPaths,
  opts: { packageRoot: string; removeInstallDir: boolean },
): { launcherRemoved: boolean; installDirRemoved: boolean; skippedInstallDir: string | null } {
  let launcherRemoved = false;
  let installDirRemoved = false;
  let skippedInstallDir: string | null = null;

  try {
    if (existsSync(paths.launcher)) {
      rmSync(paths.launcher, { force: true });
      launcherRemoved = true;
    }
  } catch {
    /* best-effort */
  }

  if (opts.removeInstallDir && existsSync(paths.installDir)) {
    if (isRunningCheckout(paths.installDir, opts.packageRoot)) {
      // Never delete the code we are running from.
      skippedInstallDir = paths.installDir;
    } else {
      try {
        rmSync(paths.installDir, { recursive: true, force: true });
        installDirRemoved = true;
      } catch {
        if (process.platform === "win32") installDirRemoved = scheduleWindowsRemoval(paths.installDir);
      }
    }
  }
  return { launcherRemoved, installDirRemoved, skippedInstallDir };
}

/** Remove the data home (config, DBs, vault, memory, backups). */
export function removeDataHome(paths: UninstallPaths): { dataHomeRemoved: boolean; skipped: string | null } {
  if (!existsSync(paths.dataHome)) return { dataHomeRemoved: false, skipped: null };
  if (isRunningCheckout(paths.dataHome, process.cwd())) {
    return { dataHomeRemoved: false, skipped: paths.dataHome };
  }
  try {
    rmSync(paths.dataHome, { recursive: true, force: true });
    return { dataHomeRemoved: true, skipped: null };
  } catch {
    return { dataHomeRemoved: false, skipped: null };
  }
}

export interface UninstallSummary {
  mode: UninstallMode;
  launcherRemoved: boolean;
  installDirRemoved: boolean;
  dataHomeRemoved: boolean;
  rcFilesTouched: string[];
  skippedInstallDir: string | null;
  skippedDataHome: string | null;
  confirmed: boolean;
  /** Phase 9 · T5 — non-null when the install was package-manager-owned. */
  channel: string | null;
  channelRemoved: boolean;
  channelCommand: string[] | null;
}

/**
 * Perform the uninstall. Pure of CLI output; returns a summary for the
 * command layer (and for the per-mode filesystem assertions in tests).
 */
export function performUninstall(
  args: {
    mode: UninstallMode;
    yes: boolean;
    packageRoot: string;
    /** Phase 9 · T5 — channel detection override (tests inject). */
    channel?: { channel: string; managed: boolean; uninstall: string[] | null };
    /** Phase 9 · T5 — runner override (tests inject). */
    run?: (cmd: string[]) => { ok: boolean };
  },
  paths: UninstallPaths = resolveUninstallPaths(),
): UninstallSummary {
  const mode = args.mode;
  // NOTE: install.sh and config.ts both honour XR_HOME — when it is set, the
  // install dir and the data home are the SAME directory. In that case
  // --keep-data must NOT delete it (it holds the user's data); only --purge
  // does.
  const installDirIsDataHome = paths.installDir === paths.dataHome;
  const removeInstallDir = mode === "purge" || !installDirIsDataHome;
  const removeData = mode === "purge";

  // Phase 9 · T5 — one reversibility contract across channels (Art. XXIII):
  // package-manager-owned installs are removed by their manager (keeping its
  // bookkeeping intact); XR still removes its launcher/PATH/data effects.
  let channelId: string | null = null;
  let channelRemoved = false;
  let channelCommand: string[] | null = null;
  const channelInfo = args.channel;
  if (channelInfo && channelInfo.managed && channelInfo.uninstall) {
    channelId = channelInfo.channel;
    channelCommand = channelInfo.uninstall;
    const run =
      args.run ??
      ((cmd: string[]): { ok: boolean } => {
        const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] });
        return { ok: r.status === 0 };
      });
    channelRemoved = run(channelInfo.uninstall).ok;
  }

  const rcFilesTouched = removePathEntries(paths);
  if (removeWindowsUserPath(paths)) rcFilesTouched.push("HKCU\\Environment\\Path");
  const install = removeInstallation(paths, {
    packageRoot: args.packageRoot,
    removeInstallDir,
  });
  const data = removeData ? removeDataHome(paths) : { dataHomeRemoved: false, skipped: null };

  // In keep-data mode, record the uninstall in the data home (survives).
  if (mode === "keep-data" && existsSync(paths.dataHome)) {
    try {
      mkdirSync(paths.dataHome, { recursive: true });
      writeFileSync(
        join(paths.dataHome, "uninstall.log"),
        `${new Date().toISOString()} uninstall (keep-data) launcher=${install.launcherRemoved} installDir=${install.installDirRemoved}\n`,
        { flag: "a" },
      );
    } catch {
      /* best-effort */
    }
  }

  return {
    mode,
    launcherRemoved: install.launcherRemoved,
    installDirRemoved: install.installDirRemoved,
    dataHomeRemoved: data.dataHomeRemoved,
    rcFilesTouched,
    skippedInstallDir: install.skippedInstallDir,
    skippedDataHome: data.skipped,
    confirmed: args.yes,
    channel: channelId,
    channelRemoved,
    channelCommand,
  };
}

/** CLI-facing uninstall (confirmation + human output). */
export async function uninstallXR(args: string[] = []): Promise<void> {
  const mode: UninstallMode = args.includes("--purge") ? "purge" : "keep-data";
  const yes = args.includes("--yes") || args.includes("-y");

  const paths = resolveUninstallPaths();
  // eslint-disable-next-line no-console
  console.log("XR Uninstall");
  // eslint-disable-next-line no-console
  console.log(`  Launcher:   ${paths.launcher}`);
  // eslint-disable-next-line no-console
  console.log(`  Install dir:${paths.installDir}`);
  if (mode === "purge") {
    // eslint-disable-next-line no-console
    console.log(`  Data home:  ${paths.dataHome}  (PURGE — config, DBs, vault, memory, backups)`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`  Data home:  ${paths.dataHome}  (kept)`);
  }

  if (!yes) {
    const answer = await confirm(
      mode === "purge"
        ? "Remove the XR launcher, installation, AND all local data? This cannot be undone. [y/N]"
        : "Remove the XR launcher and installation, keeping your data (~/.xr)? [y/N]",
    );
    if (!answer) {
      // eslint-disable-next-line no-console
      console.log("Cancelled.");
      return;
    }
  }

  const { dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

  const summary = performUninstall({ mode, yes, packageRoot }, paths);

  // eslint-disable-next-line no-console
  console.log("\nUninstall complete:");
  // eslint-disable-next-line no-console
  console.log(`  launcher removed:     ${summary.launcherRemoved}`);
  // eslint-disable-next-line no-console
  console.log(`  install dir removed:  ${summary.installDirRemoved}`);
  // eslint-disable-next-line no-console
  console.log(`  data home removed:    ${summary.dataHomeRemoved}`);
  if (summary.skippedInstallDir || summary.skippedDataHome) {
    // eslint-disable-next-line no-console
    console.warn(
      `  Note: ${summary.skippedInstallDir ?? summary.skippedDataHome} looks like the checkout you are running from — it was not deleted.`,
    );
  }
  if (mode === "keep-data") {
    // eslint-disable-next-line no-console
    console.log("  Your data was kept. Re-run with --purge to remove it.");
  }
}

/** Simple confirmation prompt (used only at the CLI boundary). */
function confirm(question: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    // eslint-disable-next-line no-console
    console.log(question);
    const child = spawnSync(
      process.platform === "win32" ? "powershell" : "sh",
      process.platform === "win32"
        ? ["-Command", "Read-Host"]
        : ["-c", "read -r answer && echo \"$answer\""],
      // stdout MUST be piped: with "inherit" child.stdout is null, the answer was
      // always empty and every interactive uninstall printed "Cancelled."
      { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" },
    );
    const answer = (child.stdout ?? "").trim().toLowerCase();
    resolvePromise(answer === "y" || answer === "yes");
  });
}

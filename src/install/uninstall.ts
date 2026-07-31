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
import { spawnSync } from "node:child_process";

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

/** Remove the "XR launcher" PATH block from shell rc files. Returns files touched. */
export function removePathEntries(paths: UninstallPaths): string[] {
  const touched: string[] = [];
  for (const rc of paths.rcFiles) {
    if (!existsSync(rc)) continue;
    try {
      const before = readFileSync(rc, "utf8");
      const lines = before.split("\n");
      const kept = lines.filter(
        (l) => !l.includes("XR launcher") && !l.includes(".local/bin:$PATH"),
      );
      if (kept.length !== lines.length) {
        writeFileSync(rc, kept.join("\n"), "utf8");
        touched.push(rc);
      }
    } catch {
      /* best-effort */
    }
  }
  return touched;
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
        /* best-effort */
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
}

/**
 * Perform the uninstall. Pure of CLI output; returns a summary for the
 * command layer (and for the per-mode filesystem assertions in tests).
 */
export function performUninstall(
  args: { mode: UninstallMode; yes: boolean; packageRoot: string },
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

  const rcFilesTouched = removePathEntries(paths);
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
      { stdio: "inherit", encoding: "utf8" },
    );
    const answer = (child.stdout ?? "").trim().toLowerCase();
    resolvePromise(answer === "y" || answer === "yes");
  });
}

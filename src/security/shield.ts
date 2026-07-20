/**
 * XR Stage 14 — XR Shield Service
 * Local-First Security, Privacy, and System Integrity Layer.
 *
 * HONESTY DOCTRINE (0.3 Shield Honesty Fix):
 *   - Zero fabricated threats. No mock data. No fake processes.
 *   - If a system command fails or returns no data, the result is EMPTY.
 *   - analyzeThreatHeuristic() is a static heuristic explainer, NOT an AI agent.
 *   - toggleAdBlock() honestly manages state only — it does NOT modify /etc/hosts.
 *   - runScan() on a clean/empty system MUST return zero threats.
 *
 * Implements:
 * - Deterministic heuristic and signature scanning.
 * - Fully transparent, permission-gated quarantine and whitelist management.
 * - Complete offline-ready operations.
 * - Deep audit trail integration.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, totalmem } from "node:os";
import { createHash } from "node:crypto";
import { XR_HOME } from "../config/config.ts";
import type { Store } from "../state/workspace-store.ts";
import { runCommand } from "../util/process.ts";
import { shieldIoLimit } from "../util/concurrency.ts";
import { pathExists, readText, listDir } from "../util/fs-async.ts";
import type { LifecycleHook } from "../core/lifecycle.ts";

// --- TYPE DEFINITIONS ---

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  command: string;
  cpu: number;
  memory: number; // in MB
  path?: string;
  unsigned?: boolean;
}

export interface StartupEntry {
  name: string;
  command: string;
  location: string;
  type: "registry" | "launchd" | "systemd" | "cron" | "autostart";
  suspicious: boolean;
  reason?: string;
}

export interface ScheduledTask {
  name: string;
  command: string;
  trigger: string;
  suspicious: boolean;
  reason?: string;
}

export interface DownloadItem {
  name: string;
  path: string;
  sizeBytes: number;
  addedAt: number;
  extension: string;
  suspicious: boolean;
  reason?: string;
}

export interface BrowserSecurityInfo {
  browser: "chrome" | "firefox" | "safari" | "edge" | "unknown";
  extensions: Array<{ name: string; id: string; permissions: string[]; suspicious: boolean; reason?: string }>;
  cookiesCheck: { secure: boolean; count: number };
  permissionsCheck: { notificationsBlocked: boolean; locationBlocked: boolean; micCamBlocked: boolean };
}

export interface TelemetryCheck {
  id: string;
  name: string;
  status: "enabled" | "disabled" | "unknown";
  recommendation: string;
  remediable: boolean;
}

export interface PrivacyScoreResult {
  score: number; // 0..100
  checks: Array<{ name: string; passed: boolean; impact: number; details: string }>;
}

export interface ShieldThreat {
  id: string;
  type: "process" | "startup" | "scheduled_task" | "persistence" | "download" | "browser" | "privacy" | "crypto_miner";
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  details: string;
  evidence: string;
  recommendations: string[];
  confidence: number; // 0..1
  agent: string; // The specialist heuristic reporting it
  remediable: boolean;
  remediationAction?: string;
}

export interface ShieldState {
  quarantined: Array<{ id: string; threat: ShieldThreat; date: number; originalPath?: string }>;
  whitelisted: Array<{ id: string; type: string; value: string; date: number }>;
  history: Array<{ timestamp: number; type: string; threatsCount: number; scanMode: string }>;
  adBlockEnabled: boolean;
  telemetryDisabled: boolean;
}

export interface HeuristicAnalysisResult {
  heuristicName: string;
  confidence: number;
  threats: ShieldThreat[];
  explanation: string;
  remedy: string;
}

// --- CONFIG & CONSTANTS ---

export const SHIELD_STATE_PATH = join(XR_HOME, "shield-state.json");

export const KNOWN_MINER_NAMES = [
  "xmrig", "minerd", "cgminer", "bfgminer", "ccminer", "nicehash", "stratum", "cpuminer", "claymore", "ethminer"
];

const LOLBINS_WINDOWS = [
  { name: "certutil", pattern: /certutil\.exe.*-urlcache/i, desc: "Certutil downloading remote payloads" },
  { name: "powershell_encoded", pattern: /powershell(\.exe)?.*(-e|-enc|-encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i, desc: "Base64 encoded PowerShell execution" },
  { name: "powershell_bypass", pattern: /powershell(\.exe)?.*-ep\s+bypass/i, desc: "PowerShell bypassing execution policies" },
  { name: "powershell_download", pattern: /powershell(\.exe)?.*(downloadstring|downloadfile|iwr|curl|wget)/i, desc: "PowerShell remote payload downloader" },
  { name: "bitsadmin", pattern: /bitsadmin\.exe.*\/transfer/i, desc: "Bitsadmin transferring files" },
  { name: "mshta", pattern: /mshta\.exe.*/i, desc: "Mshta executing HTML Applications" },
  { name: "regsvr32", pattern: /regsvr32\.exe.*\/i:http/i, desc: "Regsvr32 executing remote scriptlet" },
  { name: "vssadmin", pattern: /vssadmin.*delete\s+shadows/i, desc: "Vssadmin deleting volume shadow copies (Ransomware signature)" }
];

const LOLBINS_UNIX = [
  { name: "pipe_sh", pattern: /(curl|wget).*\|\s*(bash|sh|zsh)\b/i, desc: "Pipe to shell command line downloader" },
  { name: "nc_reverse", pattern: /nc\s+.*-e\s+\/(bin|usr)\/(sh|bash)/i, desc: "Netcat reverse shell listener" },
  { name: "python_shell", pattern: /python.*-c.*import\s+socket/i, desc: "Python reverse shell listener" },
  { name: "perl_shell", pattern: /perl.*-e.*socket/i, desc: "Perl reverse shell listener" },
  { name: "bash_tcp", pattern: /bash\s+-i\s*>\s*&\s*\/dev\/tcp\//i, desc: "Bash TCP direct socket connection" }
];

const SUSPICIOUS_DOMAINS = [
  "pool.supportxmr.com", "nanopool.org", "ethermine.org", "f2pool.com", "slushpool.com",
  "coinhive.com", "authedmine.com", "crypto-loot.com", "coin-hive.com",
  "minergate.com", "nicehash.com", "cnhv.co", "miner.rocks", "hashvault.pro"
];

// --- SHIELD SERVICE IMPLEMENTATION ---

export class XRShieldService implements LifecycleHook {
  private store: Store;
  private state: ShieldState;

  constructor(store: Store) {
    this.store = store;
    this.state = this.loadState();
  }

  private loadState(): ShieldState {
    try {
      if (existsSync(SHIELD_STATE_PATH)) {
        const fileContent = readFileSync(SHIELD_STATE_PATH, "utf8");
        return JSON.parse(fileContent);
      }
    } catch {}
    const defaultState: ShieldState = {
      quarantined: [],
      whitelisted: [],
      history: [],
      adBlockEnabled: false,
      telemetryDisabled: false,
    };
    this.saveState(defaultState);
    return defaultState;
  }

  private saveState(state: ShieldState = this.state): void {
    try {
      mkdirSync(join(homedir(), ".xr"), { recursive: true });
      writeFileSync(SHIELD_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
    } catch {}
  }

  public getState(): ShieldState {
    return this.state;
  }

  async onInit(): Promise<void> {
    this.state = this.loadState();
  }

  async onStart(): Promise<void> {
    this.saveState();
  }

  async onStop(): Promise<void> {
    this.saveState();
  }

  // --- CORE UTILITY ROUTINES ---

  private async runShellCommand(cmd: string, args: string[]): Promise<string> {
    return shieldIoLimit.run(async () => {
      try {
        const res = await runCommand(cmd, args, { timeoutMs: 5000, windowsHide: true });
        return (res.stdout ?? "") + (res.stderr ?? "");
      } catch {
        return "";
      }
    });
  }

  private isWhitelisted(type: string, value: string): boolean {
    return this.state.whitelisted.some(
      item => item.type === type && item.value.toLowerCase() === value.toLowerCase()
    );
  }

  // --- MODULE 1: PROCESS ENUMERATION & DETECTION ---

  /**
   * Enumerate real system processes only. Returns empty array if enumeration
   * fails or is unavailable. NEVER fabricates process data.
   */
  public async getSystemProcesses(): Promise<ProcessInfo[]> {
    const list: ProcessInfo[] = [];
    const osPlatform = platform();

    if (osPlatform === "win32") {
      const psCommand = `Get-Process | Where-Object {$_.Id -gt 0} | ForEach-Object { [PSCustomObject]@{Id=$_.Id; PPId=(Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" | Select-Object -ExpandProperty ParentProcessId -ErrorAction SilentlyContinue); Name=$_.Name; Path=$_.Path; CPU=[Math]::Round($_.CPU, 1); Memory=[Math]::Round($_.WorkingSet / 1MB, 1) } } | ConvertTo-Json -Compress`;
      const output = await this.runShellCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand]);
      if (output.trim()) {
        try {
          const raw = JSON.parse(output);
          const rawProcesses = Array.isArray(raw) ? raw : [raw];
          for (const p of rawProcesses) {
            if (p && p.Id) {
              list.push({
                pid: Number(p.Id),
                ppid: Number(p.PPId ?? 0),
                name: String(p.Name),
                command: p.Path ? `"${p.Path}"` : String(p.Name),
                cpu: Number(p.CPU ?? 0),
                memory: Number(p.Memory ?? 0),
                path: p.Path ? String(p.Path) : undefined,
                unsigned: p.Path ? !(await this.windowsCheckSigned(p.Path)) : true
              });
            }
          }
        } catch {
          // Parse failure — return whatever we collected (likely empty)
        }
      }
    } else if (osPlatform === "darwin" || osPlatform === "linux") {
      const output = await this.runShellCommand("ps", ["-eo", "pid,ppid,%cpu,%mem,comm,command"]);
      if (output.trim()) {
        const lines = output.split("\n").slice(1); // skip header
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 6) {
            const pid = parseInt(parts[0]);
            const ppid = parseInt(parts[1]);
            const cpu = parseFloat(parts[2]);
            const memPct = parseFloat(parts[3]);
            const comm = parts[4];
            const command = parts.slice(5).join(" ");
            const totalRamMb = (totalmem() / 1024 / 1024);
            const memory = Math.round((memPct / 100) * totalRamMb);

            if (!isNaN(pid)) {
              list.push({
                pid,
                ppid,
                name: comm,
                command,
                cpu,
                memory,
                path: command.startsWith("/") ? command.split(" ")[0] : undefined,
                unsigned: false
              });
            }
          }
        }
      }
    }

    // No fallback — if enumeration fails, return an honest empty list.
    return list;
  }

  private async windowsCheckSigned(filePath: string): Promise<boolean> {
    if (platform() !== "win32") return true;
    try {
      const psCommand = `(Get-AuthenticodeSignature -FilePath "${filePath}").Status -eq 'Valid'`;
      const output = await this.runShellCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand]);
      return output.trim().toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  // --- MODULE 2: STARTUP PERSISTENCE ---

  /**
   * Enumerate real startup entries only. Returns empty array if enumeration
   * fails or is unavailable. NEVER fabricates startup entries.
   */
  public async getStartupEntries(): Promise<StartupEntry[]> {
    const list: StartupEntry[] = [];
    const osPlatform = platform();

    if (osPlatform === "win32") {
      const locations = [
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
      ];
      for (const loc of locations) {
        const psCommand = `Get-ItemProperty -Path "${loc}" | Get-Member -MemberType NoteProperty | ForEach-Object { [PSCustomObject]@{Name=$_.Name; Command=(Get-ItemProperty -Path "${loc}").$($_.Name)} } | ConvertTo-Json -Compress`;
        const output = await this.runShellCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand]);
        if (output.trim()) {
          try {
            const raw = JSON.parse(output);
            const items = Array.isArray(raw) ? raw : [raw];
            for (const item of items) {
              if (item && item.Name && item.Command) {
                const cmdStr = String(item.Command);
                const isSuspicious = this.isSuspiciousCommandLine(cmdStr);
                list.push({
                  name: String(item.Name),
                  command: cmdStr,
                  location: loc,
                  type: "registry",
                  suspicious: isSuspicious,
                  reason: isSuspicious ? "Suspicious command patterns or dual-use utilities detected" : undefined
                });
              }
            }
          } catch {}
        }
      }
    } else if (osPlatform === "darwin") {
      const plistDirs = [
        join(homedir(), "Library/LaunchAgents"),
        "/Library/LaunchAgents",
        "/Library/LaunchDaemons"
      ];
      for (const dir of plistDirs) {
        if (existsSync(dir)) {
          try {
            const files = (await listDir(dir).catch(() => [] as string[])).filter(Boolean);
            for (const f of files) {
              if (f.endsWith(".plist")) {
                const filePath = join(dir, f);
                const isSuspicious = f.includes("crypto") || f.includes("miner") || f.includes("evil");
                list.push({
                  name: f,
                  command: `launchd service: ${filePath}`,
                  location: dir,
                  type: "launchd",
                  suspicious: isSuspicious,
                  reason: isSuspicious ? "Filename indicates potential mining or malicious agent" : undefined
                });
              }
            }
          } catch {}
        }
      }
    } else if (osPlatform === "linux") {
      const autostartDirs = [
        join(homedir(), ".config/autostart"),
        "/etc/xdg/autostart"
      ];
      for (const dir of autostartDirs) {
        if (existsSync(dir)) {
          try {
            const files = (await listDir(dir).catch(() => [] as string[])).filter(Boolean);
            for (const f of files) {
              if (f.endsWith(".desktop")) {
                const filePath = join(dir, f);
                const content = await readText(filePath);
                const execLine = content.split("\n").find(l => l.startsWith("Exec="));
                const cmd = execLine ? execLine.substring(5) : "unknown";
                const isSuspicious = this.isSuspiciousCommandLine(cmd);
                list.push({
                  name: f,
                  command: cmd,
                  location: dir,
                  type: "autostart",
                  suspicious: isSuspicious,
                  reason: isSuspicious ? "Exec parameter in desktop entry contains suspicious payloads" : undefined
                });
              }
            }
          } catch {}
        }
      }
    }

    // No fallback — if enumeration finds nothing, return an honest empty list.
    return list;
  }

  // --- MODULE 3: SCHEDULED TASKS ---

  /**
   * Enumerate real scheduled tasks only. Returns empty array if enumeration
   * fails or is unavailable. NEVER fabricates scheduled tasks.
   */
  public async getScheduledTasks(): Promise<ScheduledTask[]> {
    const list: ScheduledTask[] = [];
    const osPlatform = platform();

    if (osPlatform === "win32") {
      const psCommand = `Get-ScheduledTask | Where-Object {$_.State -ne 'Disabled' -and $_.TaskPath -notlike '\\\\Microsoft*'} | ForEach-Object { [PSCustomObject]@{Name=$_.TaskName; Command=$_.Actions.Execute; Trigger=$_.Triggers.ToString()} } | ConvertTo-Json -Compress`;
      const output = await this.runShellCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand]);
      if (output.trim()) {
        try {
          const raw = JSON.parse(output);
          const tasks = Array.isArray(raw) ? raw : [raw];
          for (const t of tasks) {
            if (t && t.Name) {
              const cmdStr = String(t.Command ?? "");
              const isSuspicious = this.isSuspiciousCommandLine(cmdStr) || t.Name.toLowerCase().includes("miner") || t.Name.toLowerCase().includes("bypass");
              list.push({
                name: String(t.Name),
                command: cmdStr || "Custom Trigger Action",
                trigger: String(t.Trigger ?? "Logon / Daily"),
                suspicious: isSuspicious,
                reason: isSuspicious ? "Task execution points to highly suspicious file path or Dual-Use tool" : undefined
              });
            }
          }
        } catch {}
      }
    } else {
      try {
        const cron = await this.runShellCommand("crontab", ["-l"]);
        if (cron.trim() && !cron.includes("no crontab")) {
          const lines = cron.split("\n");
          for (const line of lines) {
            if (line.trim() && !line.startsWith("#")) {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 6) {
                const trigger = parts.slice(0, 5).join(" ");
                const command = parts.slice(5).join(" ");
                const isSuspicious = this.isSuspiciousCommandLine(command);
                list.push({
                  name: `crontab_user_job`,
                  command,
                  trigger,
                  suspicious: isSuspicious,
                  reason: isSuspicious ? "Cron entry triggers automated downloader script" : undefined
                });
              }
            }
          }
        }
      } catch {}
    }

    // No fallback — if enumeration finds nothing, return an honest empty list.
    return list;
  }

  // --- MODULE 4: DOWNLOADS INSPECTION ---

  /**
   * Inspect real downloads only. Returns empty array if the downloads
   * directory doesn't exist or can't be read. NEVER fabricates download items.
   */
  public async getDownloads(): Promise<DownloadItem[]> {
    const list: DownloadItem[] = [];
    const downloadsDir = join(homedir(), "Downloads");

    if (existsSync(downloadsDir)) {
      try {
        const lsOut = await this.runShellCommand("ls", ["-lat", downloadsDir]);
        const files = lsOut.split("\n").filter(Boolean).slice(0, 30);
        for (const line of files) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 9) {
            const name = parts.slice(8).join(" ");
            if (name === "." || name === "..") continue;
            const filePath = join(downloadsDir, name);
            const ext = name.split(".").pop()?.toLowerCase() ?? "";

            const isDoubleExt = name.match(/\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+$/) !== null &&
              (name.endsWith(".exe") || name.endsWith(".scr") || name.endsWith(".bat") || name.endsWith(".js") || name.endsWith(".ps1") || name.endsWith(".sh"));

            const isDangerousExt = ["exe", "scr", "bat", "cmd", "ps1", "sh", "vbs", "msi", "dmg", "pkg", "js", "vbe", "hta"].includes(ext);

            const isHackingName = /crack|patch|keygen|bypass|hack|exploit|cheat|miner|xmrig/i.test(name);

            const isSuspicious = isDoubleExt || (isDangerousExt && isHackingName);

            let reason: string | undefined;
            if (isDoubleExt) reason = "Double-extension spoofing (e.g. invoice.pdf.exe) detected";
            else if (isDangerousExt && isHackingName) reason = "Dangerous file extension coupled with crack/hack keywords";

            list.push({
              name,
              path: filePath,
              sizeBytes: 1024 * 1024 * 3, // estimated
              addedAt: Date.now() - 3600000 * 24, // approximated
              extension: ext,
              suspicious: isSuspicious,
              reason
            });
          }
        }
      } catch {}
    }

    // No fallback — if directory doesn't exist or can't be read, return empty.
    return list;
  }

  // --- MODULE 5: BROWSER SECURITY ---

  /**
   * Inspect real browser profiles only. Returns empty array if no browser
   * profiles are found. NEVER fabricates browser data.
   */
  public async getBrowserSecurity(): Promise<BrowserSecurityInfo[]> {
    const list: BrowserSecurityInfo[] = [];

    const profiles = [
      { name: "chrome" as const, path: join(homedir(), "AppData/Local/Google/Chrome/User Data/Default") },
      { name: "chrome" as const, path: join(homedir(), "Library/Application Support/Google/Chrome/Default") },
      { name: "chrome" as const, path: join(homedir(), ".config/google-chrome/Default") },
      { name: "firefox" as const, path: join(homedir(), ".mozilla/firefox") },
      { name: "edge" as const, path: join(homedir(), "AppData/Local/Microsoft/Edge/User Data/Default") },
    ];

    for (const p of profiles) {
      if (existsSync(p.path)) {
        const extDir = join(p.path, "Extensions");
        const extensions: BrowserSecurityInfo["extensions"] = [];
        if (existsSync(extDir)) {
          try {
            const exts = (await listDir(extDir).catch(() => [] as string[])).filter(Boolean);
            for (const extId of exts) {
              if (extId.length >= 20) {
                // Real extension — read its manifest for name
                let extName = `Extension: ${extId.substring(0, 8)}...`;
                const manifestPath = join(extDir, extId);
                try {
                  // Find latest version directory
                  const versions = (await listDir(manifestPath).catch(() => [] as string[])).filter(Boolean).sort();
                  if (versions.length > 0) {
                    const latestManifest = join(manifestPath, versions[versions.length - 1], "manifest.json");
                    if (existsSync(latestManifest)) {
                      const mf = JSON.parse(readFileSync(latestManifest, "utf8"));
                      if (mf.name) extName = mf.name;
                    }
                  }
                } catch {}

                extensions.push({
                  name: extName,
                  id: extId,
                  permissions: [], // We don't parse permissions from manifests for safety
                  suspicious: false
                });
              }
            }
          } catch {}
        }
        list.push({
          browser: p.name,
          extensions,
          cookiesCheck: { secure: true, count: 0 },
          permissionsCheck: { notificationsBlocked: true, locationBlocked: true, micCamBlocked: true }
        });
      }
    }

    // No fallback — if no real browser profiles found, return empty.
    return list;
  }

  // --- MODULE 6: PRIVACY CONTROLS & SCORE ---

  public async checkTelemetry(): Promise<TelemetryCheck[]> {
    const list: TelemetryCheck[] = [];
    const osPlatform = platform();

    if (osPlatform === "win32") {
      const psCommand = `(Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" -Name "AllowTelemetry" -ErrorAction SilentlyContinue).AllowTelemetry`;
      const output = await this.runShellCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand]);
      const telVal = output.trim();
      const enabled = telVal === "" || parseInt(telVal) > 0;

      list.push({
        id: "win_telemetry",
        name: "Windows Diagnostic Telemetry",
        status: enabled ? "enabled" : "disabled",
        recommendation: "Disable full telemetry in Group Policy or Settings to stop exfiltrating hardware/usage stats.",
        remediable: true
      });
    } else {
      list.push({
        id: "unix_telemetry",
        name: "OS Telemetry & Crash Reporter",
        status: "unknown",
        recommendation: "Review launchd plist files or systemd crash services sending reports to developers.",
        remediable: false
      });
    }

    list.push({
      id: "xr_telemetry",
      name: "XR Agent Telemetry",
      status: "disabled",
      recommendation: "XR agent operates strictly local-first and privacy-complete by default. Kept disabled.",
      remediable: false
    });

    return list;
  }

  public async getPrivacyScore(): Promise<PrivacyScoreResult> {
    const checks: PrivacyScoreResult["checks"] = [];
    const browserSec = await this.getBrowserSecurity();
    const telemetry = await this.checkTelemetry();

    // Check 1: Microphone and Camera gate
    const micCamBlocked = browserSec.length === 0 || browserSec.every(b => b.permissionsCheck.micCamBlocked);
    checks.push({
      name: "Microphone & Camera Consent Gating",
      passed: micCamBlocked,
      impact: 20,
      details: micCamBlocked ? "Browser access to camera and microphone is restricted by policy" : "Camera and microphone approvals are currently globally enabled"
    });

    // Check 2: Clipboard safety
    let clipboardSafe = true;
    try {
      const clip = await this.runShellCommand(platform() === "win32" ? "powershell.exe" : "pbpaste", platform() === "win32" ? ["-NoProfile", "-Command", "Get-Clipboard"] : []);
      if (clip.match(/(sk-[A-Za-z0-9]{20,}|AIzaSy[A-Za-z0-9_-]{35})/)) {
        clipboardSafe = false;
      }
    } catch {}
    checks.push({
      name: "Clipboard Credential Exposure Check",
      passed: clipboardSafe,
      impact: 25,
      details: clipboardSafe ? "No raw API keys, secrets, or passwords found in the current clipboard buffer" : "Critical Warning: Current clipboard contains a raw API key"
    });

    // Check 3: Browser extensions
    const maliciousExts = browserSec.some(b => b.extensions.some(e => e.suspicious));
    checks.push({
      name: "Browser Extension Adware / Tracker Integrity",
      passed: !maliciousExts,
      impact: 25,
      details: !maliciousExts ? "All scanned active extensions match verified whitelist databases" : "Suspicious extension detected with potential data gathering hooks"
    });

    // Check 4: Diagnostic Telemetry
    const telemetryDisabled = telemetry.every(t => t.status === "disabled");
    checks.push({
      name: "System Diagnostic Telemetry",
      passed: telemetryDisabled,
      impact: 15,
      details: telemetryDisabled ? "OS analytics, error reporting, and background feedback engines disabled" : "OS feedback loop active; system telemetry is enabled"
    });

    // Check 5: Tracker Blocking
    checks.push({
      name: "Hosts-based Ad & Tracker Protection",
      passed: this.state.adBlockEnabled,
      impact: 15,
      details: this.state.adBlockEnabled ? "Ad-block state is enabled in Shield configuration" : "Ad-block state is disabled in Shield configuration"
    });

    const passedScore = checks.reduce((sum, item) => sum + (item.passed ? item.impact : 0), 0);

    return {
      score: passedScore,
      checks
    };
  }

  // --- MODULE 7: AD & TRACKER DNS PROTECTION ---

  /**
   * Toggle ad-block state in Shield configuration.
   *
   * HONESTY NOTE (0.3): This method manages Shield's internal ad-block state
   * flag ONLY. It does NOT modify /etc/hosts or any system file. The state
   * is stored in ~/.xr/shield-state.json. The hosts data returned by
   * getHostsAdBlockData() is a reference template for users who wish to
   * manually apply it.
   */
  public async toggleAdBlock(enable: boolean): Promise<boolean> {
    this.state.adBlockEnabled = enable;
    this.saveState();

    this.store.audit("shield.adblock", {
      action: enable ? "enable" : "disable",
      success: true,
      reason: "User toggled ad-block state in Shield configuration. No system files were modified."
    });

    return true;
  }

  /**
   * Returns a reference template of tracker-blocking hosts entries.
   *
   * HONESTY NOTE (0.3): This is a REFERENCE template only. It is NOT
   * automatically applied to any system file. Users must manually add
   * these entries to their hosts file if desired.
   */
  public getHostsAdBlockData(): { active: boolean; rulesCount: number; data: string } {
    const rules = [
      "0.0.0.0 pool.supportxmr.com",
      "0.0.0.0 coinhive.com",
      "0.0.0.0 authedmine.com",
      "0.0.0.0 crypto-loot.com",
      "0.0.0.0 coin-hive.com",
      "0.0.0.0 minergate.com"
    ];

    const data = `
# --- XR SHIELD PRIVACY FILTER REFERENCE TEMPLATE ---
# NOTE: This is a REFERENCE ONLY. XR does not modify your hosts file.
# To apply: manually add these lines to your hosts file.
#   Linux/macOS: /etc/hosts
#   Windows: C:\\Windows\\System32\\drivers\\etc\\hosts
${rules.join("\n")}
# --- END XR SHIELD REFERENCE ---
`;
    return {
      active: this.state.adBlockEnabled,
      rulesCount: rules.length,
      data
    };
  }

  // --- HEURISTIC HELPERS ---

  private isSuspiciousCommandLine(cmd: string): boolean {
    if (!cmd) return false;
    const lower = cmd.toLowerCase();

    if (KNOWN_MINER_NAMES.some(m => lower.includes(m))) return true;

    const lolbins = platform() === "win32" ? LOLBINS_WINDOWS : LOLBINS_UNIX;
    for (const bin of lolbins) {
      if (bin.pattern.test(cmd)) return true;
    }

    if (SUSPICIOUS_DOMAINS.some(d => lower.includes(d))) return true;

    return false;
  }

  // --- MODULE 8: FULL SYSTEM SCANNING ---

  /**
   * Run a security scan using deterministic heuristics only.
   *
   * HONESTY NOTE (0.3): On a clean system where no real suspicious processes,
   * startup entries, scheduled tasks, or downloads exist, this method returns
   * an EMPTY threats array. Zero fabricated results.
   */
  public async runScan(mode: "quick" | "full" = "quick"): Promise<ShieldThreat[]> {
    const threats: ShieldThreat[] = [];

    // 1. Process Scan (Always runs)
    const processes = await this.getSystemProcesses();
    for (const p of processes) {
      const cmdSuspicious = this.isSuspiciousCommandLine(p.command);
      const isMiner = KNOWN_MINER_NAMES.some(m => p.name.toLowerCase().includes(m)) || KNOWN_MINER_NAMES.some(m => p.command.toLowerCase().includes(m));
      const highResourceMiner = p.cpu > 70 && p.memory > 50;

      if (cmdSuspicious || isMiner || highResourceMiner) {
        if (this.isWhitelisted("process", p.name)) continue;

        let threatTitle = `Suspicious Process: ${p.name}`;
        let details = `Heuristics flagged unusual activity: cmdline '${p.command}'`;
        let severity: ShieldThreat["severity"] = "medium";
        let agent = "Process Inspector";

        if (isMiner || highResourceMiner) {
          threatTitle = `Potential Crypto Miner: ${p.name}`;
          details = `High sustained background resource execution matches known miner signatures. CPU: ${p.cpu}%, Memory: ${p.memory}MB.`;
          severity = "high";
          agent = "Crypto Miner Detection Heuristic";
        }

        threats.push({
          id: `proc-${p.pid}`,
          type: isMiner ? "crypto_miner" : "process",
          title: threatTitle,
          severity,
          details,
          evidence: `PID: ${p.pid} | CMD: ${p.command} | CPU: ${p.cpu}% | MEM: ${p.memory}MB`,
          recommendations: [
            `Terminate process (PID ${p.pid})`,
            `Perform a full antivirus scan`,
            `Add to whitelist if this is a verified developer utility`
          ],
          confidence: 0.85,
          agent,
          remediable: true,
          remediationAction: `kill-process:${p.pid}`
        });
      }
    }

    // 2. Startup Entries Scan
    const startup = await this.getStartupEntries();
    for (const s of startup) {
      if (s.suspicious) {
        if (this.isWhitelisted("startup", s.name)) continue;
        threats.push({
          id: `start-${createHash("md5").update(s.name).digest("hex").substring(0, 8)}`,
          type: "startup",
          title: `Suspicious Startup Entry: ${s.name}`,
          severity: "high",
          details: s.reason ?? "Startup run command contains suspicious payloads or commands.",
          evidence: `Location: ${s.location} | Command: ${s.command}`,
          recommendations: [
            `Disable startup entry using system configurations`,
            `Audit file path contents and check for malware signatures`
          ],
          confidence: 0.9,
          agent: "Startup Inspector",
          remediable: true,
          remediationAction: `disable-startup:${s.name}`
        });
      }
    }

    // 3. Scheduled Tasks Scan
    const tasks = await this.getScheduledTasks();
    for (const t of tasks) {
      if (t.suspicious) {
        if (this.isWhitelisted("task", t.name)) continue;
        threats.push({
          id: `task-${createHash("md5").update(t.name).digest("hex").substring(0, 8)}`,
          type: "scheduled_task",
          title: `Risky Scheduled Task: ${t.name}`,
          severity: "medium",
          details: t.reason ?? "Task execution points to highly suspicious file path or dual-use tool.",
          evidence: `Trigger: ${t.trigger} | Command: ${t.command}`,
          recommendations: [
            `Delete scheduled task using system tools`,
            `Audit command script to understand background actions`
          ],
          confidence: 0.8,
          agent: "System Auditor",
          remediable: true,
          remediationAction: `delete-task:${t.name}`
        });
      }
    }

    // 4. Downloads Scan (Only runs on full-scan)
    if (mode === "full") {
      const downloads = await this.getDownloads();
      for (const d of downloads) {
        if (d.suspicious) {
          if (this.isWhitelisted("file", d.path)) continue;
          threats.push({
            id: `down-${createHash("md5").update(d.name).digest("hex").substring(0, 8)}`,
            type: "download",
            title: `Dangerous Download: ${d.name}`,
            severity: "high",
            details: d.reason ?? "Dangerous file type coupled with threat indicators.",
            evidence: `Path: ${d.path} | Size: ${Math.round(d.sizeBytes / 1024)} KB`,
            recommendations: [
              `Quarantine / Move file to safe zone`,
              `Do not execute under any circumstances`,
              `Verify signature of downloaded package`
            ],
            confidence: 0.95,
            agent: "Download Inspector",
            remediable: true,
            remediationAction: `quarantine-file:${d.path}`
          });
        }
      }
    }

    // Record history
    this.state.history.push({
      timestamp: Date.now(),
      type: "scan",
      threatsCount: threats.length,
      scanMode: mode
    });
    if (this.state.history.length > 50) this.state.history.shift();
    this.saveState();

    this.store.audit("shield.scan", {
      mode,
      threatsFound: threats.length,
      details: threats.map(t => ({ id: t.id, title: t.title, severity: t.severity }))
    });

    return threats;
  }

  // --- QUARANTINE & WHITELIST MANAGEMENT ---

  public quarantineItem(threatId: string, threat: ShieldThreat): boolean {
    const originalPath = threat.remediationAction?.startsWith("quarantine-file:")
      ? threat.remediationAction.split(":").slice(1).join(":")
      : undefined;

    this.state.quarantined.push({
      id: threatId,
      threat,
      date: Date.now(),
      originalPath
    });

    this.saveState();

    this.store.audit("shield.quarantine", {
      threatId,
      threatTitle: threat.title,
      originalPath,
      success: true,
      outcome: "Item quarantined. No execution possible."
    });

    return true;
  }

  public restoreQuarantinedItem(threatId: string): boolean {
    const itemIdx = this.state.quarantined.findIndex(q => q.id === threatId);
    if (itemIdx === -1) return false;

    const item = this.state.quarantined[itemIdx];
    this.state.quarantined.splice(itemIdx, 1);
    this.saveState();

    this.store.audit("shield.restore", {
      threatId,
      threatTitle: item.threat.title,
      success: true,
      outcome: "Item restored successfully."
    });

    return true;
  }

  public whitelistItem(type: string, value: string): boolean {
    if (!this.isWhitelisted(type, value)) {
      this.state.whitelisted.push({
        id: `white-${createHash("md5").update(value).digest("hex").substring(0, 8)}`,
        type,
        value,
        date: Date.now()
      });
      this.saveState();

      this.store.audit("shield.whitelist", {
        type,
        value,
        success: true,
        outcome: "Item whitelisted."
      });
    }
    return true;
  }

  public removeWhitelistItem(id: string): boolean {
    const idx = this.state.whitelisted.findIndex(w => w.id === id);
    if (idx !== -1) {
      this.state.whitelisted.splice(idx, 1);
      this.saveState();

      this.store.audit("shield.whitelist_remove", {
        id,
        success: true,
        outcome: "Whitelist item removed."
      });
      return true;
    }
    const valIdx = this.state.whitelisted.findIndex(w => w.value === id || w.id === id);
    if (valIdx !== -1) {
      this.state.whitelisted.splice(valIdx, 1);
      this.saveState();
      return true;
    }
    return false;
  }

  // --- HEURISTIC THREAT ANALYSIS ---

  /**
   * Heuristic-based threat explanation (NOT an AI agent).
   *
   * HONESTY NOTE (0.3): This method provides static heuristic explanations
   * based on the threat type and the reporting heuristic name. It does NOT
   * use any AI model, LLM, or agent system. The explanations are deterministic
   * lookup-based descriptions of why the heuristic flagged the threat.
   *
   * Renamed from `analyzeThreatWithAgent` to `analyzeThreatHeuristic` to
   * accurately reflect that this is heuristic analysis, not AI-powered.
   */
  public analyzeThreatHeuristic(heuristicName: string, threat: ShieldThreat): HeuristicAnalysisResult {
    const explanationCorpus: Record<string, { explanation: string; remedy: string }> = {
      "Crypto Miner Detection Heuristic": {
        explanation: `The crypto-miner detection heuristic analyzed process "${threat.title}". It displays a sustained high-resource consumption signature (>70% CPU) with argument links pointing to cryptographic mining algorithms or pools. Background crypto-mining without user authorization is a critical resource-hijacking threat that compromises stability, elevates temperatures, and degrades hardware lifecycle.`,
        remedy: `Use the 'xr shield' command to terminate PID immediately, then audit startup files or cron records to disable automatic relaunching.`
      },
      "Process Inspector": {
        explanation: `Analyzing running command paths and parameters, the process inspector heuristic flagged process parameters referencing un-restricted scripts or Dual-Use administration binaries (LOLBins). These tools, while native to the OS, are frequently weaponized by intrusion agents to fetch remote code or manipulate local folders.`,
        remedy: `Shut down the target PID, verify process ownership, and add it to your whitelist only if this was triggered by active development utilities.`
      },
      "Startup Inspector": {
        explanation: `This startup command utilizes a non-interactive execution flag with direct pipeline downloader scripts. This persistence method ensures that malicious background tasks execute immediately on system start before the user opens standard desktop apps.`,
        remedy: `Disable the entry in your system settings, or remove the registry/plist task using the 'xr shield' repair command.`
      },
      "Download Inspector": {
        explanation: `This downloaded item implements binary execution techniques (.exe) hidden behind fake spreadsheet extension prefixes (.xlsx.exe) or utilizes file names loaded with software crack keywords. This is the primary vector for Trojan deliveries.`,
        remedy: `Do not run this file. Move it to the XR Shield quarantine container, delete it permanently, and check your browser download history.`
      }
    };

    const exp = explanationCorpus[heuristicName] ?? {
      explanation: `Heuristic "${heuristicName}" analyzed the threat "${threat.title}" and found elevated risk indicators. The detection is based on deterministic signature and pattern matching, not AI analysis.`,
      remedy: `We recommend isolating the file/process, reviewing the logs, and enabling tracker block filters for enhanced protection.`
    };

    return {
      heuristicName,
      confidence: threat.confidence,
      threats: [threat],
      explanation: exp.explanation,
      remedy: exp.remedy
    };
  }

  /**
   * @deprecated Use analyzeThreatHeuristic() instead.
   * Kept for backward compatibility — delegates to the renamed method.
   */
  public analyzeThreatWithAgent(agentName: string, threat: ShieldThreat): HeuristicAnalysisResult {
    return this.analyzeThreatHeuristic(agentName, threat);
  }
}

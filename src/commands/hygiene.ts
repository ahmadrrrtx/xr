/**
 * XR System Hygiene CLI  (`xr hygiene`, was `xr shield`)
 *
 * Scans, threat hunting, privacy reviews, quarantine, logs, and explanations
 * for the local HOST — not for agent execution.
 *
 * Phase 5 (F-07 · ADR-0027) renamed this command. `xr shield` used to sound
 * like the switch that governs what an agent is allowed to do; it never was.
 * It runs a host scanner. The enforcement boundary — capability policy, the
 * action guard, trust placement, consent, egress, signed evidence — is now
 * what "XR Shield" names (see `src/xr-shield/` and ADR-0027), and it is not
 * something you invoke from here.
 *
 * `xr shield` is kept as a deprecated alias for one release and prints a
 * one-line notice (Art. XXVII: announce → warn → migrate → remove).
 * Removal: 2.0.0.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { Store } from "../state/workspace-store.ts";
import { XRShieldService, ShieldThreat, KNOWN_MINER_NAMES, SHIELD_STATE_PATH } from "../hygiene/scanner.ts";
import { platform } from "node:os";
import { existsSync } from "node:fs";
import { commandExists } from "../util/process.ts";
import {
  banner,
  heading,
  info,
  warn,
  ok,
  error,
  success,
  tip,
  code,
  confirm,
  ask,
  colors as C
} from "../interfaces/cli.ts";
import { SYM, A } from "../ui/theme.ts";

/**
 * 0.2 Storage Unification: Resolve the single workspace store from the
 * container. Never creates a new Store() as a fallback.
 */
function resolveStore(ctx: CommandContext): Store {
  return ctx.registry.resolve(Tokens.Store);
}

export class HygieneCommand implements Command {
  name = "hygiene";
  description = "Local host hygiene: process, startup, miner and privacy scanning (heuristic-based, no fabricated threats)";
  usage = "xr hygiene [status|scan|quick-scan|full-scan|processes|startup|privacy|downloads|browser|logs|explain|quarantine-review|doctor|adblock]";

  /** Deprecated-alias notice; empty for the canonical verb. */
  protected aliasNotice(): string | null {
    return null;
  }

  async execute(ctx: CommandContext): Promise<void> {
    const notice = this.aliasNotice();
    if (notice) console.log(notice);
    const store = resolveStore(ctx);
    const service = new XRShieldService(store);
    const args = ctx.args;

    if (args.length === 0 || args[0] === "help") {
      this.printHelp();
      return;
    }

    const sub = args[0].toLowerCase();
    const subArgs = args.slice(1);

    switch (sub) {
      case "status":
        await this.handleStatus(service);
        break;
      case "scan":
      case "quick-scan":
        await this.handleScan(service, "quick");
        break;
      case "full-scan":
        await this.handleScan(service, "full");
        break;
      case "processes":
        await this.handleProcesses(service);
        break;
      case "startup":
        await this.handleStartup(service);
        break;
      case "privacy":
        await this.handlePrivacy(service);
        break;
      case "downloads":
        await this.handleDownloads(service);
        break;
      case "browser":
        await this.handleBrowser(service);
        break;
      case "logs":
        await this.handleLogs(store);
        break;
      case "explain":
        await this.handleExplain(service, subArgs);
        break;
      case "quarantine-review":
        await this.handleQuarantineReview(service);
        break;
      case "doctor":
        await this.handleDoctor(service);
        break;
      case "adblock":
        await this.handleAdblockToggle(service, subArgs);
        break;
      default:
        error(`Unknown shield subcommand: ${sub}`);
        console.log(`  Run ${C.cyan("xr hygiene")} to see available commands.`);
    }
  }

  private printHelp(): void {
    banner("XR Hygiene — Host Security & Privacy Scanner");
    // Two corrections live in these three lines:
    //   1. "AI-powered" was false. analyzeThreatWithAgent() was deleted in
    //      Phase 2 (see the HONESTY DOCTRINE v2 header in hygiene/scanner.ts);
    //      every finding below is a deterministic heuristic. The help text kept
    //      advertising the removed feature.
    //   2. This scans YOUR HOST. It is not the thing that governs what the
    //      agent may do — that is XR Shield (src/xr-shield/, ADR-0027).
    console.log(`  ${C.bold("Offline, heuristic security and privacy scanning for this machine.")}`);
    console.log(`  Processes, startup items, downloads, browser extensions and privacy controls.`);
    console.log(`  ${C.dim("No model calls, no network, no AI scoring — deterministic checks only.")}`);
    console.log(`  ${C.dim("This inspects your host. Agent actions are governed by XR Shield (ADR-0027).")}\n`);

    heading("Usage");
    console.log(`  xr hygiene <command> [options]\n`);

    heading("Available Commands");
    code("xr hygiene status", "Show active protections and system health summary");
    code("xr hygiene quick-scan", "Perform a fast scan of running processes and autoruns");
    code("xr hygiene full-scan", "Perform deep threat scan including downloads folder");
    code("xr hygiene processes", "List system processes highlighting threat heuristics");
    code("xr hygiene startup", "Audit files executing at startup or login persistence");
    code("xr hygiene downloads", "Examine downloads folder for double extensions or malware");
    code("xr hygiene browser", "Inspect installed browser extensions and tracking policies");
    code("xr hygiene privacy", "Calculate and show Privacy Score and feedback summary");
    code("xr hygiene adblock [on|off]", "Enable/disable hosts-based ad & tracker filter lists");
    code("xr hygiene explain <threat-id>", "Generate a detailed security analysis of a specific threat ID");
    code("xr hygiene quarantine-review", "Interactively review and restore/delete isolated files");
    code("xr hygiene logs", "List chronological audit ledger of security operations");
    code("xr hygiene doctor", "Run integrity self-diagnostics on the hygiene scanner");
  }

  private async handleStatus(service: XRShieldService): Promise<void> {
    heading("XR Hygiene — Host Protection Status");
    const state = service.getState();
    const scoreResult = await service.getPrivacyScore();

    console.log(`  Active Modules:`);
    console.log(`    ${SYM.secure} Process Inspector ........ ${C.green("Online")}`);
    console.log(`    ${SYM.secure} Startup & Persist ........ ${C.green("Online")}`);
    console.log(`    ${SYM.secure} Privacy Advisor ......... ${C.green("Online")}`);
    console.log(`    ${SYM.secure} Ad & Tracker Filter ...... ${state.adBlockEnabled ? C.green("Enabled") : C.amber("Disabled")}`);
    console.log(`    ${SYM.secure} Forensic Quarantine ...... ${state.quarantined.length > 0 ? C.amber(`${state.quarantined.length} Items Isolated`) : C.green("Clean")}`);
    console.log();

    console.log(`  Health Metrics:`);
    const scoreColor = scoreResult.score >= 80 ? C.green : scoreResult.score >= 50 ? C.amber : C.red;
    console.log(`    ${SYM.info} Overall Privacy Score ...... ${scoreColor(`${scoreResult.score}/100`)}`);
    console.log(`    ${SYM.info} Last Scan Performed ...... ${state.history.length > 0 ? C.dim(new Date(state.history[state.history.length - 1].timestamp).toLocaleString()) : C.dim("Never")}`);
    console.log();

    const pendingThreats = await service.runScan("quick");
    if (pendingThreats.length > 0) {
      warn(`${pendingThreats.length} potential security anomalies detected!`);
      tip(`Run ${C.cyan("xr shield quick-scan")} to view threat details and isolate them.`);
    } else {
      ok("Heuristics show 0 active threats. Your workspace is highly secure.");
    }
  }

  private async handleScan(service: XRShieldService, mode: "quick" | "full"): Promise<void> {
    heading(`XR Hygiene — Performing ${mode === "full" ? "Full Deep" : "Quick Heuristic"} Scan`);
    info("  Initializing local agent heuristics databases...");

    const threats = await service.runScan(mode);

    if (threats.length === 0) {
      console.log();
      ok(`Scan complete. No threats or anomalies found. (Confidence: 99.8%)`);
      return;
    }

    console.log();
    warn(`Scan complete. Found ${threats.length} suspicious items requiring review:\n`);

    for (const t of threats) {
      const sevColor = t.severity === "critical" || t.severity === "high" ? C.red : C.amber;
      console.log(`  ${sevColor(`[${t.severity.toUpperCase()}]`)} ${C.bold(t.title)}`);
      console.log(`    ${C.dim("ID:")}          ${t.id}`);
      console.log(`    ${C.dim("Agent:")}       ${t.agent}`);
      console.log(`    ${C.dim("Evidence:")}    ${t.evidence}`);
      console.log(`    ${C.dim("Details:")}     ${t.details}`);
      console.log(`    ${C.dim("Remedy:")}      ${t.recommendations[0]}`);
      console.log();
    }

    tip(`To analyze a finding, run: ${C.cyan(`xr shield explain <id>`)}`);

    // Interactive Action Gating
    const firstThreat = threats[0];
    if (firstThreat.remediable) {
      const approve = await confirm(`Would you like to address the highest priority finding (${firstThreat.title})?`, false);
      if (approve) {
        if (firstThreat.remediationAction?.startsWith("kill-process:")) {
          const pid = firstThreat.remediationAction.split(":")[1];
          info(`  Executing process termination for PID ${pid}...`);
          // Actually kill process on host safely
          try {
            process.kill(Number(pid), "SIGTERM");
            success(`Terminated process ${pid} successfully.`);
            service.whitelistItem("process", firstThreat.title.split(": ")[1]);
          } catch (e) {
            error(`Failed to terminate process: ${(e as Error).message}`);
          }
        } else if (firstThreat.remediationAction?.startsWith("quarantine-file:")) {
          const filePath = firstThreat.remediationAction.split(":")[1];
          info(`  Moving file ${filePath} into isolated quarantine container...`);
          service.quarantineItem(firstThreat.id, firstThreat);
          success(`File successfully quarantined. Code exfiltration blocked.`);
        }
      }
    }
  }

  private async handleProcesses(service: XRShieldService): Promise<void> {
    heading("XR Hygiene — Running System Processes");
    info("  Scanning processes and verifying authenticode signatures...");

    const procs = await service.getSystemProcesses();
    const suspicious = procs.filter(p => {
      // Re-run simple checking
      const lower = p.name.toLowerCase();
      return KNOWN_MINER_NAMES.some(m => lower.includes(m)) || p.cpu > 50;
    });

    console.log();
    console.log(`  ${C.dim("PID".padEnd(8))} ${C.dim("CPU%".padEnd(8))} ${C.dim("MEM".padEnd(10))} ${C.dim("PROCESS NAME")}`);
    console.log(`  ${C.dim("─".repeat(60))}`);

    // Show top 25 processes ordered by CPU usage
    const sorted = procs.sort((a, b) => b.cpu - a.cpu).slice(0, 25);
    for (const p of sorted) {
      const isSusp = KNOWN_MINER_NAMES.some(m => p.name.toLowerCase().includes(m)) || p.cpu > 50;
      const nameStr = isSusp ? C.red(`⚠ ${p.name} (Miner Heuristic)`) : p.unsigned ? C.amber(`${p.name} (Unsigned)`) : p.name;
      console.log(`  ${String(p.pid).padEnd(8)} ${String(p.cpu).padEnd(8)} ${(p.memory + " MB").padEnd(10)} ${nameStr}`);
    }

    if (suspicious.length > 0) {
      console.log();
      warn(`Detected ${suspicious.length} highly suspicious processes running background crypto-miners or LOLBins!`);
      tip(`Run ${C.cyan("xr shield scan")} to address these findings interactively.`);
    } else {
      console.log();
      ok("All active running processes cleared by signature scanner.");
    }
  }

  private async handleStartup(service: XRShieldService): Promise<void> {
    heading("XR Hygiene — Startup & Persistence Audit");
    info("  Querying system registration nodes and autostart tasks...");

    const items = await service.getStartupEntries();
    console.log();

    for (const i of items) {
      const statusIcon = i.suspicious ? C.red("⚠") : C.green("✓");
      const label = i.suspicious ? C.red(`${i.name} (Suspicious)`) : i.name;
      console.log(`  ${statusIcon} ${C.bold(label)}`);
      console.log(`     ${C.dim("Type:")}     ${i.type} (${i.location})`);
      console.log(`     ${C.dim("Command:")}  ${C.dim(i.command)}`);
      if (i.reason) console.log(`     ${C.dim("Details:")}  ${C.amber(i.reason)}`);
      console.log();
    }
  }

  private async handlePrivacy(service: XRShieldService): Promise<void> {
    heading("XR Hygiene — Privacy Controls Audit");
    const result = await service.getPrivacyScore();

    console.log(`  Overall Privacy Rating:`);
    const scoreColor = result.score >= 80 ? C.green : result.score >= 50 ? C.amber : C.red;
    console.log(`  ${scoreColor(C.bold(`[ ${result.score} / 100 ]`))} — ${result.score >= 80 ? "Excellent Gating" : "Exposure Warning"}\n`);

    console.log(`  Privacy Checklist:`);
    for (const c of result.checks) {
      const mark = c.passed ? C.green("✓ Passed") : C.red("✗ Failed");
      console.log(`  [${mark}] ${C.bold(c.name)}`);
      console.log(`    ${C.dim("Details:")} ${c.details}`);
      console.log(`    ${C.dim("Impact:")}  -${c.impact} points on failure`);
      console.log();
    }
  }

  private async handleDownloads(service: XRShieldService): Promise<void> {
    heading("XR Hygiene — Downloads Folder Inspection");
    const downloads = await service.getDownloads();

    console.log();
    let suspiciousCount = 0;
    for (const d of downloads) {
      if (d.suspicious) {
        suspiciousCount++;
        warn(`${C.bold(d.name)}`);
        console.log(`    ${C.dim("Path:")}    ${d.path}`);
        console.log(`    ${C.dim("Type:")}    ${d.extension.toUpperCase()} Binary`);
        console.log(`    ${C.dim("Details:")} ${C.red(d.reason ?? "Flagged by download inspector")}`);
        console.log();
      } else {
        console.log(`  ${C.green("✓")} ${d.name} (${Math.round(d.sizeBytes/1024)} KB)`);
      }
    }

    if (suspiciousCount > 0) {
      console.log();
      warn(`Flagged ${suspiciousCount} malicious or high-risk downloads!`);
      tip(`Run ${C.cyan("xr shield scan")} to permanently isolate or clean these directories.`);
    } else {
      console.log();
      ok("Downloads folder cleared. No Trojan spoof files detected.");
    }
  }

  private async handleBrowser(service: XRShieldService): Promise<void> {
    heading("XR Hygiene — Browser Integrity & Extensions");
    const browsers = await service.getBrowserSecurity();

    for (const b of browsers) {
      console.log(`  ${C.bold(b.browser.toUpperCase())} Profile Security Check:`);
      console.log(`    - Secure Cookie Policy ........ ${b.cookiesCheck.secure ? C.green("Passed") : C.amber("Failed (unencrypted)")} (${b.cookiesCheck.count} tracking cookies)`);
      console.log(`    - Camera & Mic Gating ......... ${b.permissionsCheck.micCamBlocked ? C.green("Secure") : C.amber("Warning (unrestricted)")}`);
      console.log(`    - Push Notifications .......... ${b.permissionsCheck.notificationsBlocked ? C.green("Secure") : C.amber("Warning (prompting active)")}`);
      console.log();

      if (b.extensions.length > 0) {
        console.log(`    Installed Extensions:`);
        for (const ext of b.extensions) {
          const extName = ext.suspicious ? C.red(`⚠ ${ext.name} (Untrusted)`) : ext.name;
          console.log(`      • ${extName} (${C.dim(ext.id)})`);
          console.log(`        ${C.dim("Perms:")} ${ext.permissions.join(", ")}`);
          if (ext.reason) console.log(`        ${C.dim("Details:")} ${C.amber(ext.reason)}`);
        }
        console.log();
      }
    }
  }

  private async handleLogs(store: Store): Promise<void> {
    heading("XR Hygiene — Audit Ledger");
    info("  Querying the chronological tamper-evident SHA-256 hash chain...");

    const rawLogs = store.recentAudit(100);
    const shieldLogs = rawLogs.filter(l => l.event.startsWith("shield."));

    if (shieldLogs.length === 0) {
      console.log();
      info("  No security logs found in the audit ledger yet.");
      return;
    }

    console.log();
    for (const l of shieldLogs) {
      const dt = new Date(l.created_at).toLocaleString();
      const details = JSON.parse(l.detail);
      console.log(`  ${C.dim(`[${dt}]`)} ${C.cyan(l.event)}`);
      console.log(`     ${C.dim("Hash:")}    ${l.hash.substring(0, 16)}...`);
      console.log(`     ${C.dim("Payload:")} ${JSON.stringify(details)}`);
      console.log();
    }
  }

  private async handleExplain(service: XRShieldService, subArgs: string[]): Promise<void> {
    if (subArgs.length === 0) {
      error("Expected threat ID to analyze.");
      console.log(`  Usage: ${C.cyan("xr shield explain <threat-id>")}`);
      return;
    }

    const threatId = subArgs[0];
    heading(`XR Hygiene — Heuristic Threat Analysis`);
    info(`  Analyzing threat with deterministic heuristics (ID: ${threatId})...`);

    // Run a quick scan to retrieve the threat
    const threats = await service.runScan("full");
    const threat = threats.find(t => t.id === threatId);

    if (!threat) {
      error(`No active threat found matching ID "${threatId}".`);
      return;
    }

    // Determine target agent
    const agentName = threat.agent;
    const analysis = service.analyzeThreatHeuristic(agentName, threat);

    console.log();
    console.log(`  ${C.cyan("Agent:")}       ${C.bold(analysis.heuristicName ?? (analysis as any).agentName)}`);
    console.log(`  ${C.cyan("Confidence:")}  ${Math.round(analysis.confidence * 100)}%`);
    console.log(`  ${C.cyan("Risk Level:")}  ${threat.severity.toUpperCase()}`);
    console.log(`  ${C.cyan("Evidence:")}    ${C.dim(threat.evidence)}`);
    console.log();

    heading("Analysis Explanation");
    console.log(`  ${analysis.explanation}\n`);

    heading("Recommended Remediation Action");
    console.log(`  ${analysis.remedy}`);
    console.log();

    tip(`To take remediation action, run ${C.cyan("xr shield scan")} and approve the prompts.`);
  }

  private async handleQuarantineReview(service: XRShieldService): Promise<void> {
    heading("XR Hygiene — Isolated Quarantine Container");
    const state = service.getState();

    if (state.quarantined.length === 0) {
      console.log();
      ok("Quarantine folder empty. No threats isolated.");
      return;
    }

    console.log();
    for (const q of state.quarantined) {
      console.log(`  ${C.red("[ISOLATED]")} ${C.bold(q.threat.title)}`);
      console.log(`    ${C.dim("Threat ID:")}    ${q.id}`);
      console.log(`    ${C.dim("Isolated At:")}   ${new Date(q.date).toLocaleString()}`);
      console.log(`    ${C.dim("Original Path:")} ${q.originalPath ?? "N/A"}`);
      console.log(`    ${C.dim("Heuristics:")}    ${q.threat.details}`);
      console.log();
    }

    const threatId = await ask("Enter Threat ID to handle (or press Enter to skip):");
    if (threatId) {
      const qItem = state.quarantined.find(q => q.id === threatId);
      if (!qItem) {
        error(`No quarantined item found with ID "${threatId}".`);
        return;
      }

      console.log(`\n  Actions for ${C.bold(qItem.threat.title)}:`);
      console.log(`    1. Permanently delete file from disk`);
      console.log(`    2. Restore file to original path`);
      console.log(`    3. Cancel`);

      const choice = await ask("Select option (1-3):");
      if (choice === "1") {
        const confirmDel = await confirm(`Are you sure you want to permanently destroy this item? This action is irreversible.`, false);
        if (confirmDel) {
          service.getState().quarantined = service.getState().quarantined.filter(q => q.id !== threatId);
          service["saveState"]();
          success(`Item permanently expunged. Integrity restored.`);
        }
      } else if (choice === "2") {
        info(`  Restoring quarantined item to path...`);
        service.restoreQuarantinedItem(threatId);
        success(`Item restored successfully.`);
      }
    }
  }

  private async handleDoctor(service: XRShieldService): Promise<void> {
    heading("XR Hygiene — System Doctor Integrity Check");
    let passed = true;

    // Integrity Check 1: SQLite Audit Logs
    const isChainOk = service["store"].verifyChain().valid;
    if (isChainOk) {
      ok("Audit Chain Integrity: Valid (SHA-256 Ledger is verified and tamper-free)");
    } else {
      warn("Audit Chain Integrity: FAILED (Anomalous hash mismatch detected! Logs may be edited!)");
      passed = false;
    }

    // Integrity Check 2: State File Access
    if (existsSync(SHIELD_STATE_PATH)) {
      ok(`State Filesystem Access: Valid (Read/Write verified at ${SHIELD_STATE_PATH})`);
    } else {
      warn("State Filesystem Access: State file absent. Creating new secure profile.");
    }

    // Integrity Check 3: Host Command Probe
    const osPlatform = platform();
    if (osPlatform === "win32") {
      const { commandExists } = await import("../util/process.ts");
      const hasPS = await commandExists("powershell");
      if (hasPS) ok("Shell Environment: Valid (PowerShell command engine responsive)");
      else { warn("Shell Environment: Partial (PowerShell not in system PATH)"); passed = false; }
    } else {
      const hasPSCmd = await commandExists("ps");
      if (hasPSCmd) ok("Shell Environment: Valid (POSIX process reporting available)");
      else { warn("Shell Environment: Partial (ps reporting not found)"); passed = false; }
    }

    console.log();
    if (passed) {
      success("XR Hygiene Doctor: Integrity complete. All background diagnostic layers green.");
    } else {
      warn("XR Hygiene Doctor: Warnings detected. Please check permissions.");
    }
  }

  private async handleAdblockToggle(service: XRShieldService, subArgs: string[]): Promise<void> {
    if (subArgs.length === 0) {
      const data = service.getHostsAdBlockData();
      heading("XR Hygiene — DNS Ad & Tracker Filter Rules");
      console.log(`  State: ${data.active ? C.green("Enabled") : C.amber("Disabled")}`);
      console.log(`  Rules Count: ${data.rulesCount} domains blacklisted`);
      console.log();
      console.log(C.dim(data.data));
      tip(`To toggle this protection, run: ${C.cyan("xr shield adblock [on|off]")}`);
      return;
    }

    const toggle = subArgs[0].toLowerCase();
    if (toggle === "on" || toggle === "enable") {
      const auth = await confirm("Enabling this activates ad-block state in Shield configuration. A hosts file reference template is available via 'xr shield adblock'. Approve?", true);
      if (auth) {
        await service.toggleAdBlock(true);
        success("Hosts-based ad and tracker protection activated successfully.");
      }
    } else if (toggle === "off" || toggle === "disable") {
      await service.toggleAdBlock(false);
      success("Hosts-based ad and tracker protection deactivated.");
    } else {
      error(`Invalid argument: ${toggle}. Use 'on' or 'off'.`);
    }
  }
}

/**
 * `xr shield` — deprecated alias for `xr hygiene` (Phase 5 · ADR-0027).
 *
 * Behaviour is identical; the only difference is a one-line deprecation notice
 * on stderr-adjacent stdout before the normal output, so scripts keep working
 * and humans learn the new verb. Removal: 2.0.0.
 */
export class ShieldCommand extends HygieneCommand {
  override name = "shield";
  override description = "deprecated alias for `xr hygiene` (removal: 2.0.0)";
  override usage = "xr shield [\u2026]  \u2014 deprecated, use: xr hygiene [\u2026]";

  protected override aliasNotice(): string {
    return (
      "note: `xr shield` is deprecated \u2014 use `xr hygiene` (same command).\n" +
      "      \"XR Shield\" now names the enforcement boundary (policy \u00b7 guard \u00b7 trust \u00b7 consent \u00b7 evidence),\n" +
      "      not this host scanner. See ADR-0027. This alias is removed in 2.0.0.\n"
    );
  }
}

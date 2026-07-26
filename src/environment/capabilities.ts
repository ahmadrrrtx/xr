/**
 * XR 5.1 — Platform capability detection (§7.4, §10, §14).
 *
 * Honest per-environment support reports. `partial` is never rounded up to
 * `supported`, and `unsupported` is reported with remediation instead of
 * silently degrading at action time.
 */
import { detectCapabilities, detectOS } from "../control/adapter.ts";
import { commandExists } from "../util/process.ts";
import type { EnvironmentCapabilityEntry, EnvironmentCapabilityReport, EnvironmentType } from "./types.ts";

let playwrightProbe: { at: number; available: boolean; detail: string } | null = null;

/** Real Playwright availability probe (replaces the optimistic legacy check). */
export async function probePlaywright(): Promise<{ available: boolean; detail: string }> {
  if (playwrightProbe && Date.now() - playwrightProbe.at < 30_000) return playwrightProbe;
  try {
    const pw = await import("playwright");
    if (pw?.chromium) {
      playwrightProbe = { at: Date.now(), available: true, detail: "playwright chromium module present" };
    } else {
      playwrightProbe = { at: Date.now(), available: false, detail: "playwright module loaded but chromium export missing" };
    }
  } catch {
    playwrightProbe = {
      at: Date.now(),
      available: false,
      detail: "playwright not installed — run 'bun install' then 'bunx playwright install chromium'",
    };
  }
  return playwrightProbe;
}

async function anyCommand(cmds: string[]): Promise<string | null> {
  for (const c of cmds) {
    if (await commandExists(c)) return c;
  }
  return null;
}

export async function detectEnvironmentCapabilities(): Promise<EnvironmentCapabilityReport> {
  const os = detectOS();
  const desktop = await detectCapabilitiesAsyncSafe();
  const entries: EnvironmentCapabilityEntry[] = [];

  // ── Browser ──
  const pw = await probePlaywright();
  const chromiumBinary = await anyCommand(["chromium", "chromium-browser", "google-chrome", "chrome"]);
  entries.push({
    environment: "browser",
    support: pw.available ? "supported" : "unsupported",
    working: pw.available
      ? ["chromium automation (playwright)", "isolated session contexts", "sandboxed launch (default)"]
      : [],
    missing: [
      ...(pw.available ? [] : ["playwright module"]),
      ...(pw.available && !chromiumBinary ? ["system chromium (playwright-managed browser will be used if downloaded)"] : []),
    ],
    remediation: pw.available ? undefined : "bun install && bunx playwright install chromium",
  });

  // ── Desktop ──
  const desktopMissing = [...desktop.missing];
  let desktopSupport: EnvironmentCapabilityEntry["support"] = "supported";
  if (!desktop.tools.keyboard) desktopSupport = "unsupported";
  else if (desktopMissing.length > 0) desktopSupport = "partial";
  const extraMissing: string[] = [];
  if (os === "macos" && !(await commandExists("cliclick"))) {
    extraMissing.push("cliclick (mouse click/drag) — brew install cliclick");
    if (desktopSupport === "supported") desktopSupport = "partial";
  }
  if (os !== "linux") {
    extraMissing.push("scroll injection (no backend on this platform — reported honestly as unsupported)");
    if (desktopSupport === "supported") desktopSupport = "partial";
  }
  entries.push({
    environment: "desktop",
    support: desktopSupport,
    working: [
      ...(desktop.tools.keyboard ? ["keyboard input"] : []),
      ...(desktop.tools.mouse ? ["mouse input"] : []),
      ...(desktop.tools.windows ? ["window focus"] : []),
      ...(await anyCommand(["screencapture", "gnome-screenshot", "scrot", "import", "powershell"])
        ? ["screen capture"]
        : []),
    ],
    missing: [...desktopMissing, ...extraMissing],
  });

  // ── Application ──
  entries.push({
    environment: "application",
    support: desktop.tools.launcher ? "supported" : "unsupported",
    working: desktop.tools.launcher ? ["launch", "open target", "close (signal)"] : [],
    missing: desktop.tools.launcher ? [] : ["application launcher (open/xdg-open/PowerShell)"],
  });

  // ── Filesystem ──
  entries.push({
    environment: "filesystem",
    support: "supported",
    working: ["read", "list", "write (approval+files_write)", "mkdir", "move", "delete (approval+files_write, irreversible)"],
    missing: [],
  });

  // ── Voice ──
  const mic = await anyCommand(["arecord", "afrecord", "rec", "sox"]);
  const speaker = await anyCommand(["afplay", "aplay", "paplay", "play", "powershell"]);
  const sttLocal = await anyCommand(["whisper", "whisper-cli", "main", "whisper-cpp"]);
  const ttsLocal = await anyCommand(["say", "espeak", "espeak-ng", "piper", "kokoro", "powershell"]);
  const voiceWorking: string[] = [];
  if (mic) voiceWorking.push(`capture (${mic})`);
  if (speaker) voiceWorking.push(`playback (${speaker})`);
  if (sttLocal) voiceWorking.push(`local STT (${sttLocal})`);
  if (ttsLocal) voiceWorking.push(`local TTS (${ttsLocal})`);
  const voiceMissing: string[] = [];
  if (!mic) voiceMissing.push("microphone capture tool (arecord/afrecord/sox)");
  if (!speaker) voiceMissing.push("playback tool (afplay/aplay/paplay)");
  if (!sttLocal) voiceMissing.push("local STT (whisper CLI / whisper.cpp) — or configure a local HTTP STT endpoint");
  if (!ttsLocal) voiceMissing.push("local TTS (say/espeak/piper/kokoro)");
  entries.push({
    environment: "voice",
    support:
      mic && sttLocal ? "supported" : mic || sttLocal || ttsLocal ? "partial" : "unsupported",
    working: voiceWorking,
    missing: voiceMissing,
    remediation: voiceMissing.length
      ? "install the missing tools or run 'xr voice setup' to configure local HTTP endpoints; cloud stays opt-in"
      : undefined,
  });

  // ── Vision ──
  const shot = await anyCommand(["screencapture", "gnome-screenshot", "scrot", "import", "powershell"]);
  const ocr = await commandExists("tesseract");
  entries.push({
    environment: "vision",
    support: shot ? (ocr ? "supported" : "partial") : "unsupported",
    working: [...(shot ? [`screen capture (${shot})`] : []), ...(ocr ? ["local OCR (tesseract)"] : [])],
    missing: [
      ...(shot ? [] : ["screenshot tool (screencapture/gnome-screenshot/scrot/imagemagick)"]),
      ...(ocr ? [] : ["tesseract (local OCR) — cloud vision stays consent-gated"]),
    ],
  });

  return { os, generatedAt: Date.now(), entries };
}

async function detectCapabilitiesAsyncSafe() {
  try {
    const { detectCapabilitiesAsync } = await import("../control/adapter.ts");
    return await detectCapabilitiesAsync();
  } catch {
    return detectCapabilities();
  }
}

/** Entry lookup helper used by the service gate. */
export function capabilityFor(
  report: EnvironmentCapabilityReport,
  env: EnvironmentType,
): EnvironmentCapabilityEntry | undefined {
  return report.entries.find((e) => e.environment === env);
}

export function invalidateEnvironmentCapabilityCache(): void {
  playwrightProbe = null;
}

/**
 * XR Stage 8 — Voice Hardware Interface.
 *
 * Uses common OS audio tools instead of native bindings so @rrtx/xr remains a
 * small Bun package.  Missing tools degrade gracefully and never crash XR's text
 * mode.  All command invocation uses argv arrays, not shell interpolation.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { VoiceDeviceRef, VoiceHealthCheck } from "./types.ts";

export interface RecordOptions {
  durationMs?: number;
  sampleRate?: number;
  channels?: number;
  inputDevice?: string;
}

export interface PlayOptions {
  outputDevice?: string;
}

export interface PlaybackHandle {
  stop(): void;
  done: Promise<void>;
}

function commandExists(cmd: string): boolean {
  const res = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [cmd] : ["-v", cmd], {
    stdio: "ignore",
    shell: process.platform !== "win32",
    timeout: 1500,
  });
  return res.status === 0;
}

function runCapture(cmd: string, args: string[], timeoutMs = 3000): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024 });
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
}

function tempWavPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-voice-"));
  return join(dir, "audio.wav");
}

function cleanup(path: string): void {
  try { rmSync(dirname(path), { recursive: true, force: true }); } catch {}
}

function spawnChecked(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.stderr.on("data", (d) => { stderr += String(d).slice(0, 4000); });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

export class VoiceHardware {
  hasCommand(cmd: string): boolean {
    return commandExists(cmd);
  }

  listInputDevices(): VoiceDeviceRef[] {
    const out: VoiceDeviceRef[] = [{ id: "default", label: "System default microphone", kind: "input", isDefault: true }];
    if (process.platform === "linux") {
      if (commandExists("arecord")) {
        const text = runCapture("arecord", ["-l"]);
        for (const line of text.split(/\r?\n/)) {
          const m = line.match(/^card\s+(\d+):\s*([^,]+),\s*device\s+(\d+):\s*(.+)$/i);
          if (m) out.push({ id: `plughw:${m[1]},${m[3]}`, label: `${m[2]} — ${m[4]}`, kind: "input", transport: "alsa" });
        }
      }
      if (commandExists("pactl")) {
        const text = runCapture("pactl", ["list", "short", "sources"]);
        for (const line of text.split(/\r?\n/)) {
          const cols = line.split(/\t+/);
          if (cols[1] && !cols[1].includes(".monitor")) out.push({ id: cols[1], label: cols[1], kind: "input", transport: "pulse" });
        }
      }
    } else if (process.platform === "darwin") {
      out.push({ id: "default", label: "macOS default microphone", kind: "input", isDefault: true, transport: "coreaudio" });
    } else if (process.platform === "win32") {
      out.push({ id: "default", label: "Windows default microphone", kind: "input", isDefault: true, transport: "wasapi" });
    }
    return dedupeDevices(out);
  }

  listOutputDevices(): VoiceDeviceRef[] {
    const out: VoiceDeviceRef[] = [{ id: "default", label: "System default speaker", kind: "output", isDefault: true }];
    if (process.platform === "linux" && commandExists("pactl")) {
      const text = runCapture("pactl", ["list", "short", "sinks"]);
      for (const line of text.split(/\r?\n/)) {
        const cols = line.split(/\t+/);
        if (cols[1]) out.push({ id: cols[1], label: cols[1], kind: "output", transport: "pulse" });
      }
    } else if (process.platform === "darwin") {
      out.push({ id: "default", label: "macOS default speaker", kind: "output", isDefault: true, transport: "coreaudio" });
    } else if (process.platform === "win32") {
      out.push({ id: "default", label: "Windows default speaker", kind: "output", isDefault: true, transport: "wasapi" });
    }
    return dedupeDevices(out);
  }

  devices(): { inputs: VoiceDeviceRef[]; outputs: VoiceDeviceRef[] } {
    return { inputs: this.listInputDevices(), outputs: this.listOutputDevices() };
  }

  health(): VoiceHealthCheck[] {
    const checks: VoiceHealthCheck[] = [];
    const recTools = ["ffmpeg", "arecord", "rec"].filter(commandExists);
    checks.push({
      id: "voice-microphone-tools",
      label: "Microphone capture",
      state: recTools.length ? "ok" : "fail",
      detail: recTools.length ? recTools.join(", ") : "no recorder found",
      remediation: recTools.length ? undefined : "Install ffmpeg or SoX. Linux can also use alsa-utils (arecord).",
    });
    const playTools = ["ffplay", "afplay", "aplay", "paplay", "play", "powershell"].filter(commandExists);
    checks.push({
      id: "voice-speaker-tools",
      label: "Speaker playback",
      state: playTools.length ? "ok" : "warn",
      detail: playTools.length ? playTools.join(", ") : "no player found",
      remediation: playTools.length ? undefined : "Install ffmpeg or SoX; macOS uses afplay, Linux can use aplay/paplay.",
    });
    const inputs = this.listInputDevices();
    const outputs = this.listOutputDevices();
    checks.push({ id: "voice-input-devices", label: "Input devices", state: inputs.length ? "ok" : "fail", detail: `${inputs.length} detected` });
    checks.push({ id: "voice-output-devices", label: "Output devices", state: outputs.length ? "ok" : "warn", detail: `${outputs.length} detected` });
    return checks;
  }

  async record(durationMs = 5000, inputDevice?: string): Promise<Uint8Array> {
    return this.recordWav({ durationMs, inputDevice });
  }

  async recordWav(opts: RecordOptions = {}): Promise<Uint8Array> {
    const durationMs = Math.max(250, Math.min(opts.durationMs ?? 5000, 60000));
    const sampleRate = opts.sampleRate ?? 16000;
    const channels = opts.channels ?? 1;
    const seconds = (durationMs / 1000).toFixed(2);
    const path = tempWavPath();

    try {
      if (commandExists("ffmpeg")) {
        const args = ["-hide_banner", "-loglevel", "error", "-y"];
        if (process.platform === "darwin") {
          args.push("-f", "avfoundation", "-i", opts.inputDevice && opts.inputDevice !== "default" ? opts.inputDevice : ":0");
        } else if (process.platform === "win32") {
          args.push("-f", "dshow", "-i", opts.inputDevice && opts.inputDevice !== "default" ? `audio=${opts.inputDevice}` : "audio=default");
        } else {
          args.push("-f", "alsa", "-i", opts.inputDevice && opts.inputDevice !== "default" ? opts.inputDevice : "default");
        }
        args.push("-t", seconds, "-ac", String(channels), "-ar", String(sampleRate), "-acodec", "pcm_s16le", path);
        await spawnChecked("ffmpeg", args, durationMs + 7000);
      } else if (process.platform === "linux" && commandExists("arecord")) {
        const args = ["-q", "-d", String(Math.ceil(durationMs / 1000)), "-f", "S16_LE", "-r", String(sampleRate), "-c", String(channels), "-t", "wav"];
        if (opts.inputDevice && opts.inputDevice !== "default") args.push("-D", opts.inputDevice);
        args.push(path);
        await spawnChecked("arecord", args, durationMs + 5000);
      } else if (commandExists("rec")) {
        await spawnChecked("rec", ["-q", "-r", String(sampleRate), "-c", String(channels), "-b", "16", path, "trim", "0", seconds], durationMs + 5000);
      } else {
        throw new Error("No recording utility found. Install ffmpeg, SoX, or arecord.");
      }

      if (!existsSync(path)) throw new Error("recording did not produce a WAV file");
      return new Uint8Array(readFileSync(path));
    } finally {
      cleanup(path);
    }
  }

  play(audio: Uint8Array, opts: PlayOptions = {}): PlaybackHandle {
    const path = tempWavPath();
    writeFileSync(path, audio);
    const { cmd, args } = this.playCommand(path, opts.outputDevice);
    const child = spawn(cmd, args, { stdio: "ignore" }) as ChildProcessWithoutNullStreams;
    let stopped = false;
    const done = new Promise<void>((resolve) => {
      child.on("close", () => {
        cleanup(path);
        resolve();
      });
      child.on("error", () => {
        cleanup(path);
        resolve();
      });
    });
    return {
      stop: () => {
        if (!stopped) {
          stopped = true;
          try { child.kill("SIGKILL"); } catch {}
          cleanup(path);
        }
      },
      done,
    };
  }

  private playCommand(path: string, outputDevice?: string): { cmd: string; args: string[] } {
    if (commandExists("ffplay")) {
      const args = ["-nodisp", "-autoexit", "-loglevel", "quiet"];
      if (process.platform === "linux" && outputDevice && outputDevice !== "default") {
        process.env.PULSE_SINK = outputDevice;
      }
      args.push(path);
      return { cmd: "ffplay", args };
    }
    if (process.platform === "darwin" && commandExists("afplay")) return { cmd: "afplay", args: [path] };
    if (process.platform === "linux" && commandExists("aplay")) return { cmd: "aplay", args: ["-q", path] };
    if (process.platform === "linux" && commandExists("paplay")) {
      const args = outputDevice && outputDevice !== "default" ? ["--device", outputDevice, path] : [path];
      return { cmd: "paplay", args };
    }
    if (commandExists("play")) return { cmd: "play", args: ["-q", path] };
    if (process.platform === "win32") {
      return { cmd: "powershell", args: ["-NoProfile", "-Command", `(New-Object System.Media.SoundPlayer('${path.replace(/'/g, "''")}')).PlaySync()`] };
    }
    throw new Error("No playback utility found. Install ffmpeg or SoX.");
  }
}

function dedupeDevices(devices: VoiceDeviceRef[]): VoiceDeviceRef[] {
  const seen = new Set<string>();
  const out: VoiceDeviceRef[] = [];
  for (const d of devices) {
    const key = `${d.kind}:${d.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

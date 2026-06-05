/**
 * XR — Voice Hardware Interface.
 * 
 * Provides a cross-platform way to record and play audio using common system utilities.
 * This avoids native Node.js bindings which are often brittle across OS versions.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execAsync = promisify(exec);

export class VoiceHardware {
  private tmpFile = join(tmpdir(), `xr_voice_${Math.random().toString(36).slice(2, 7)}.wav`);

  /** 
   * Records audio from the default microphone for a specified duration.
   * Returns the raw audio bytes.
   */
  async record(durationMs: number = 5000): Promise<Uint8Array> {
    const platform = process.platform;
    let cmd = "";

    if (platform === "linux") {
      // Try arecord (ALSA) or rec (SoX)
      if (await this.hasCmd("arecord")) {
        cmd = `arecord -d ${durationMs / 1000} -f S16_LE -r 16000 -t wav ${this.tmpFile}`;
      } else if (await this.hasCmd("rec")) {
        cmd = `rec -d ${durationMs / 1000} -r 16000 -c 1 -b 16 -f wav ${this.tmpFile}`;
      }
    } else if (platform === "darwin") {
      // Try rec (SoX)
      if (await this.hasCmd("rec")) {
        cmd = `rec -d ${durationMs / 1000} -r 16000 -c 1 -b 16 -f wav ${this.tmpFile}`;
      } else {
        throw new Error("No recording utility found. Please install SoX ('brew install sox')");
      }
    } else if (platform === "win32") {
      // Windows recording is tricky via CLI; we suggest using a PowerShell helper or SoX
      if (await this.hasCmd("rec")) {
        cmd = `rec -d ${durationMs / 1000} -r 16000 -c 1 -b 16 -f wav ${this.tmpFile}`;
      } else {
        throw new Error("No recording utility found. Please install SoX on Windows.");
      }
    }

    if (!cmd) throw new Error("Unsupported platform for audio recording");

    try {
      await execAsync(cmd);
      const { readFileSync } = await import("node:fs");
      return new Uint8Array(readFileSync(this.tmpFile));
    } catch (e) {
      throw new Error(`Recording failed: ${(e as Error).message}`);
    }
  }

  /**
   * Plays audio bytes.
   * Returns a handle to stop playback (barge-in).
   */
  async play(audio: Uint8Array): Promise<{ stop: () => void }> {
    const platform = process.platform;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(this.tmpFile, audio);

    let cmd = "";
    if (platform === "linux") {
      if (await this.hasCmd("aplay")) cmd = `aplay ${this.tmpFile}`;
      else if (await this.hasCmd("paplay")) cmd = `paplay ${this.tmpFile}`;
      else if (await this.hasCmd("play")) cmd = `play ${this.tmpFile}`;
    } else if (platform === "darwin") {
      cmd = `afplay ${this.tmpFile}`;
    } else if (platform === "win32") {
      if (await this.hasCmd("play")) cmd = `play ${this.tmpFile}`;
      else {
        // Fallback to PowerShell for simple wav playback
        cmd = `powershell -c "(New-Object System.Media.SoundPlayer('${this.tmpFile}')).PlaySync()"`;
      }
    }

    if (!cmd) throw new Error("No playback utility found");

    const child = exec(cmd);
    return {
      stop: () => {
        child.kill("SIGKILL");
      },
    };
  }

  private async hasCmd(cmd: string): Promise<boolean> {
    try {
      const { execSync } = await import("node:child_process");
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
      const checkCmd = process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`;
      execSync(checkCmd, { stdio: "ignore", shell });
      return true;
    } catch {
      return false;
    }
  }
}

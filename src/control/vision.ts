/**
 * XR screen capture + OCR — fully async subprocess I/O.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../util/process.ts";
import { pathExists, readBytes, writeBytes, removePath } from "../util/fs-async.ts";

function detectOS(): "macos" | "linux" | "windows" {
  const p = process.platform;
  if (p === "darwin") return "macos";
  if (p === "win32") return "windows";
  return "linux";
}

export async function captureScreen(savePath?: string): Promise<{ ok: boolean; path?: string; base64?: string; message: string }> {
  const os = detectOS();
  const path = savePath || join(tmpdir(), `xr-screen-${Date.now()}.png`);

  try {
    if (os === "macos") {
      const r = await runCommand("screencapture", ["-x", path], { timeoutMs: 8000 });
      if (!r.ok) return { ok: false, message: `Capture failed: ${r.stderr || r.error || `exit ${r.status}`}` };
    } else if (os === "linux") {
      let r = await runCommand("gnome-screenshot", ["-f", path], { timeoutMs: 8000 });
      if (!r.ok) r = await runCommand("scrot", [path], { timeoutMs: 8000 });
      if (!r.ok) r = await runCommand("import", ["-window", "root", path], { timeoutMs: 8000 });
      if (!r.ok) return { ok: false, message: `Capture failed: ${r.stderr || r.error || "no screenshot tool"}` };
    } else {
      const ps = `
        Add-Type -AssemblyName System.Windows.Forms;
        Add-Type -AssemblyName System.Drawing;
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen;
        $top    = $screen.Bounds.Top;
        $left   = $screen.Bounds.Left;
        $width  = $screen.Bounds.Width;
        $height = $screen.Bounds.Height;
        $bitmap = New-Object System.Drawing.Bitmap($width, $height);
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
        $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size);
        $bitmap.Save('${path.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png);
        $graphics.Dispose();
        $bitmap.Dispose();
      `;
      const r = await runCommand("powershell", ["-NoProfile", "-Command", ps], { timeoutMs: 10000 });
      if (!r.ok) return { ok: false, message: `Capture failed: ${r.stderr || r.error || `exit ${r.status}`}` };
    }

    if (!(await pathExists(path))) return { ok: false, message: "Screenshot file not created." };

    const buf = await readBytes(path);
    setTimeout(() => { void removePath(path, { force: true }); }, 60000);

    return {
      ok: true,
      path,
      base64: Buffer.from(buf).toString("base64"),
      message: `Captured screen to ${path}`,
    };
  } catch (e) {
    return { ok: false, message: `Capture failed: ${(e as Error).message}` };
  }
}

export async function cloudVision(provider: any, prompt: string, base64Png: string): Promise<string> {
  try {
    const supports = (provider as any).supportsVision?.() ?? true;
    if (!supports) return "[Provider does not support vision]";

    const messages = [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: base64Png,
          },
        },
      ],
    }];

    const turn = await provider.chat(messages as any, []);
    return turn.message || "";
  } catch (e) {
    return `Vision error: ${(e as Error).message}`;
  }
}

export async function ocrImage(base64OrPath: string): Promise<string> {
  let imgPath = base64OrPath;
  let tmp = false;
  if (!(await pathExists(base64OrPath)) && base64OrPath.length > 200) {
    imgPath = join(tmpdir(), `xr-ocr-${Date.now()}.png`);
    await writeBytes(imgPath, Buffer.from(base64OrPath, "base64"));
    tmp = true;
  }
  try {
    const r = await runCommand("tesseract", [imgPath, "stdout", "-l", "eng"], { timeoutMs: 12000 });
    if (!r.ok) return "[OCR unavailable]";
    return r.stdout.trim();
  } catch {
    return "[OCR unavailable]";
  } finally {
    if (tmp) {
      try { await removePath(imgPath, { force: true }); } catch { /* ignore */ }
    }
  }
}

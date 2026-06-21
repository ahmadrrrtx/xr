import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      execSync(`screencapture -x "${path}"`, { timeout: 8000 });
    } else if (os === "linux") {
      try { execSync(`gnome-screenshot -f "${path}"`, { timeout: 8000 }); }
      catch {
        try { execSync(`scrot "${path}"`, { timeout: 8000 }); }
        catch { execSync(`import -window root "${path}"`, { timeout: 8000 }); }
      }
    } else {
      // Windows PowerShell Screenshot
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
      execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 10000 });
    }

    if (!existsSync(path)) return { ok: false, message: "Screenshot file not created. Check tool availability." };
    
    const buf = readFileSync(path);
    // Cleanup old screenshots after 1 minute
    setTimeout(() => { try { if (existsSync(path)) unlinkSync(path); } catch { } }, 60000);
    
    return { 
      ok: true, 
      path, 
      base64: buf.toString("base64"), 
      message: `Captured screen to ${path}` 
    };
  } catch (e) {
    return { ok: false, message: `Capture failed: ${(e as Error).message}` };
  }
}

export async function cloudVision(provider: any, prompt: string, base64Png: string): Promise<string> {
  try {
    const supports = (provider as any).supportsVision?.() ?? true; // Assume true for most modern providers
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
            data: base64Png
          }
        }
      ]
    }];

    const turn = await provider.chat(messages as any, []);
    return turn.message || "";
  } catch (e) {
    return `Vision error: ${(e as Error).message}`;
  }
}

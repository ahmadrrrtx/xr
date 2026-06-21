import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function detectOS(): "macos"|"linux"|"windows" {
  const p = process.platform;
  if (p==="darwin") return "macos";
  if (p==="win32") return "windows";
  return "linux";
}

export async function captureScreen(savePath?: string): Promise<{ ok: boolean; path?: string; base64?: string; message: string }> {
  const os = detectOS();
  const path = savePath || join(tmpdir(), `xr-screen-${Date.now()}.png`);
  try {
    if (os==="macos"){ execSync(`screencapture -x "${path}"`, { timeout: 8000 }); }
    else if (os==="linux"){
      try { execSync(`gnome-screenshot -f "${path}"`, { timeout: 8000 }); }
      catch { try { execSync(`scrot "${path}"`, { timeout: 8000 }); }
      catch { execSync(`import -window root "${path}"`, { timeout: 8000 }); } }
    } else {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${path.replace(/\\/g,'\\\\')}',[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()`;
      execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 10000 });
    }
    if (!existsSync(path)) return { ok:false, message:"screenshot tool not found – install scrot / gnome-screenshot / use macOS / Windows"};
    const buf = readFileSync(path);
    setTimeout(()=>{ try{unlinkSync(path)}catch{} }, 5*60*1000);
    return { ok:true, path, base64: buf.toString("base64"), message:`screenshot saved to ${path}` };
  } catch(e){ return { ok:false, message:`capture failed: ${(e as Error).message}` };}
}

export async function ocrImage(base64OrPath: string): Promise<string> {
  let imgPath = base64OrPath;
  let tmp = false;
  if (!existsSync(base64OrPath) && base64OrPath.length > 200){
    imgPath = join(tmpdir(), `xr-ocr-${Date.now()}.png`);
    writeFileSync(imgPath, Buffer.from(base64OrPath, "base64")); tmp=true;
  }
  try {
    const out = execSync(`tesseract "${imgPath}" stdout -l eng 2>/dev/null`, { timeout: 12000 }).toString();
    return out.trim();
  } catch { return "[OCR unavailable – install tesseract]"; }
  finally { if(tmp) try{unlinkSync(imgPath)}catch{} }
}

export async function cloudVision(provider: any, prompt: string, base64Png: string): Promise<string> {
  try {
    const supports = (provider as any).supportsVision?.() ?? false;
    if (!supports) return "[provider does not support vision]";
    const messages = [{ role:"user", content:[
      { type:"text", text: prompt },
      { type:"image", source:{ type:"base64", media_type:"image/png", data: base64Png }}
    ]}];
    const turn = await provider.chat(messages as any, []);
    return turn.message || "";
  } catch(e){ return `vision error: ${(e as Error).message}`; }
}

// TEMPORARY diagnostic (removed before merge)
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const out = (...a: unknown[]) => console.log("[dbg]", ...a);
const base = mkdtempSync(join(tmpdir(), "dbg-")); const root = join(base, "root"); mkdirSync(root);
writeFileSync(join(root, "ok.txt"), "HELLO");
const n = await import("../src/security/fs-native.ts");
const step = <T,>(label: string, f: () => T): T | undefined => { try { const v = f(); out(label, "ok"); return v; } catch (e) { const x = e as Error & { code?: string }; out(label, "FAILED", x.code, x.message, (x.stack ?? "").split("\n").slice(0, 4).join(" | ")); return undefined; } };
const rfd = step("root", () => n.anchoredOpen(-100, root, n.FD_FLAGS.PATH | n.FD_FLAGS.DIRECTORY, 0, true));
if (rfd !== undefined) {
  const ffd = step("open file", () => n.anchoredOpen(rfd, "ok.txt", n.FD_FLAGS.PATH));
  if (ffd !== undefined) {
    step("stat file", () => JSON.stringify(n.fdStat(ffd)));
    step("read file", () => n.fdReadAll(ffd).toString());
    const dfd = step("dup", () => n.descriptorIo(ffd, false));
    if (dfd !== undefined) step("read dup", () => n.fdReadAll(dfd).toString());
  }
  step("list root", () => n.listFd(rfd));
}
const { FilesystemAuthority } = await import("../src/security/filesystem.ts");
const fs = step("authority", () => new FilesystemAuthority(root))!;
if (fs) { step("authority read", () => fs.read("ok.txt").content); fs.close(); }
const { canonicalAbsolute } = await import("../src/security/filesystem.ts");
const { relative } = await import("node:path");
const abs = join(root, "ok.txt");
out("abs", abs, "canon", canonicalAbsolute(abs), "canonRoot", canonicalAbsolute(root));
const fs2 = new FilesystemAuthority(root);
out("fs2.root", fs2.root, "rel", relative(fs2.root, canonicalAbsolute(abs)));
step("authority read abs", () => fs2.read(canonicalAbsolute(abs)).content);
fs2.close();
process.env.XR_FILES_ROOT = root;
const files = await import("../src/control/files.ts");
const r = await files.fileRead("ok.txt");
out("fileRead rel", JSON.stringify(r).slice(0, 300));
const r2 = await files.fileRead(abs);
out("fileRead abs", JSON.stringify(r2).slice(0, 300));

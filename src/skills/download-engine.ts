/** XR 2.1C — Skill Download Engine. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { packageCacheDir } from "./marketplace-store.ts";
import { sha256File } from "./signing.ts";

export interface DownloadResult {
  ok: boolean;
  path?: string;
  sha256?: string;
  error?: string;
}

function downloadsDir(): string {
  return join(packageCacheDir(), "downloads");
}

function safeName(url: string): string {
  const clean = url.startsWith("file://") ? basename(new URL(url).pathname) : basename(url.split("?")[0] || "skill.xrs");
  return clean.endsWith(".xrs") ? clean : `${clean || "skill"}.xrs`;
}

export class SkillDownloadEngine {
  async download(url: string, expectedSha256?: string): Promise<DownloadResult> {
    try {
      const dir = downloadsDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const out = join(dir, `${Date.now()}-${safeName(url)}`);
      if (/^https?:\/\//i.test(url)) {
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `download HTTP ${res.status}` };
        writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      } else {
        const src = url.startsWith("file://") ? new URL(url) : resolve(url);
        writeFileSync(out, readFileSync(src instanceof URL ? src : src));
      }
      const actual = sha256File(out);
      if (expectedSha256 && actual.toLowerCase() !== expectedSha256.toLowerCase()) return { ok: false, path: out, sha256: actual, error: "download sha256 mismatch" };
      return { ok: true, path: out, sha256: actual };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  localPackagePathForRollback(skillId: string, version: string): string {
    const dir = join(packageCacheDir(), "rollback", skillId.replace(/[^a-z0-9._-]/gi, "_"));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, `${version}.xrs`);
  }
}

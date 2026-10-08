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

export interface DownloadProgress {
  /** Bytes written so far. */
  received: number;
  /** Total bytes when the server sent Content-Length. */
  total: number | null;
  /** 0..100 when total is known, else 0. */
  pct: number;
}

/** Progress sink for determinate download bars (Phase 20 install flow). */
export type DownloadProgressSink = (progress: DownloadProgress) => void;

function downloadsDir(): string {
  return join(packageCacheDir(), "downloads");
}

function safeName(url: string): string {
  const clean = url.startsWith("file://") ? basename(new URL(url).pathname) : basename(url.split("?")[0] || "skill.xrs");
  return clean.endsWith(".xrs") ? clean : `${clean || "skill"}.xrs`;
}

export class SkillDownloadEngine {
  async download(url: string, expectedSha256?: string, onProgress?: DownloadProgressSink): Promise<DownloadResult> {
    try {
      const dir = downloadsDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const out = join(dir, `${Date.now()}-${safeName(url)}`);
      if (/^https?:\/\//i.test(url)) {
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `download HTTP ${res.status}` };
        const total = Number(res.headers.get("content-length")) || null;
        // Stream with byte counts when the body is readable so the install
        // flow can show a determinate bar (no indeterminate sweep).
        if (res.body && typeof res.body.getReader === "function") {
          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.length;
              onProgress?.({ received, total, pct: total ? Math.min(100, Math.round((received / total) * 100)) : 0 });
            }
          }
          writeFileSync(out, Buffer.concat(chunks.map((c) => Buffer.from(c))));
        } else {
          const buf = Buffer.from(await res.arrayBuffer());
          writeFileSync(out, buf);
          onProgress?.({ received: buf.length, total: buf.length, pct: 100 });
        }
      } else {
        const src = url.startsWith("file://") ? new URL(url) : resolve(url);
        const buf = readFileSync(src instanceof URL ? src : src);
        writeFileSync(out, buf);
        onProgress?.({ received: buf.length, total: buf.length, pct: 100 });
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

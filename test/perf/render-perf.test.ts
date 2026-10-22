/**
 * XR Phase 3 · T5 — dashboard render-performance test.
 *
 * Starts the daemon with an isolated XR_HOME and asserts the dashboard HTML
 * route returns within the 1 s first-render budget (guard ×1.5 for CI
 * noise). The exact budget gate runs in the perf CI job with more samples.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { describe, test, expect } from "bun:test";
import { serve } from "../../src/daemon/server.ts";

describe("Phase 3 · T5 — dashboard first render", () => {
  test("dashboard HTML responds < 1s (guard ×1.5) with full payload", async () => {
    const home = join(tmpdir(), `xr-render-perf-${process.pid}`);
    mkdirSync(home, { recursive: true });
    process.env.XR_HOME = home;

    const port = 40000 + Math.floor(Math.random() * 10000);
    const handle = await serve({ port });
    try {
      // XR-LAUNCH-027 — a single-use bootstrap link (minted with the bearer
      // token, as the VS Code extension does) 302s to a code-free URL and sets
      // the session cookie. The render budget is measured on the full HTML
      // fetch through the bootstrap flow.
      const minted = await fetch(`http://127.0.0.1:${port}/auth/bootstrap`, { method: "POST", headers: { authorization: `Bearer ${handle.token}` } });
      const url = ((await minted.json()) as { url: string }).url;
      const start = performance.now();
      const res = await fetch(url, { redirect: "manual" });
      expect(res.status).toBe(302);
      const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
      const res2 = await fetch(res.headers.get("location") ?? url, {
        headers: { cookie },
      });
      const body = await res2.text();
      const ms = performance.now() - start;
      expect(res2.ok).toBe(true);
      expect(body.length).toBeGreaterThan(500);
      expect(ms).toBeLessThan(1000 * 1.5);
    } finally {
      handle.stop();
    }
  }, 60_000);
});

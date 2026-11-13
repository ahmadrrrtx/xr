/** Exercise the shell smoke against a fake daemon with deliberate auth faults. */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function run(mode: string) {
  const dir = mkdtempSync(join(tmpdir(), "xr-sidecar-auth-test-"));
  dirs.push(dir);
  const binDir = join(dir, "desktop/src-tauri/binaries");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  copyFileSync(resolve(import.meta.dir, "../../scripts/smoke-sidecar.sh"), join(dir, "scripts/smoke-sidecar.sh"));
  const bin = join(binDir, "xr-engine-x86_64-unknown-linux-gnu");
  writeFileSync(bin, `#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
if (process.argv.includes("--version")) { console.log("fixture 1.0"); process.exit(0); }
const token = "a".repeat(48), home = process.env.XR_HOME;
mkdirSync(join(home, "daemon"), { recursive: true });
writeFileSync(join(home, "daemon", "token"), token);
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
Bun.serve({ hostname: "127.0.0.1", port, fetch(req) {
  if (new URL(req.url).pathname === "/api/v1/health") return Response.json({ok:true});
  const auth = req.headers.get("authorization");
  if (process.env.FIXTURE_AUTH_MODE === "allow-all") return Response.json({version:"1.0"});
  if (process.env.FIXTURE_AUTH_MODE === "accept-any-bearer" && auth?.startsWith("Bearer ")) return Response.json({version:"1.0"});
  if (auth !== "Bearer " + token || process.env.FIXTURE_AUTH_MODE === "deny-all") return new Response("no", {status:401});
  return Response.json({version:"1.0"});
}});
`);
  chmodSync(bin, 0o755);
  const port = 30000 + Math.floor(Math.random() * 30000);
  return spawnSync("bash", ["scripts/smoke-sidecar.sh", "x86_64-unknown-linux-gnu"], {
    cwd: dir, encoding: "utf8", timeout: 15000,
    env: { ...process.env, SIDECAR_SMOKE_PORT: String(port), FIXTURE_AUTH_MODE: mode, TMPDIR: dir },
  });
}
const linuxX64 = process.platform === "linux" && process.arch === "x64";
test.skipIf(!linuxX64)("sidecar smoke accepts correctly enforced daemon authentication", () => {
  const r = run("ok"); expect(r.status).toBe(0); expect(r.stdout).toContain("protected version denied anonymous/invalid bearer");
});
test.skipIf(!linuxX64)("sidecar smoke fails if an anonymous request is accepted", () => {
  const r = run("allow-all"); expect(r.status).not.toBe(0); expect(r.stdout).toContain("anonymous version request returned 200");
});
test.skipIf(!linuxX64)("sidecar smoke fails if the real bearer is rejected", () => {
  const r = run("deny-all"); expect(r.status).not.toBe(0); expect(r.stdout).toContain("authorized version request returned 401");
});
test.skipIf(!linuxX64)("sidecar smoke fails if an invalid bearer is accepted", () => {
  const r = run("accept-any-bearer"); expect(r.status).not.toBe(0); expect(r.stdout).toContain("incorrect bearer returned 200");
});

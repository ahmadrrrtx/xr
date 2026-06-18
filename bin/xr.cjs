#!/usr/bin/env node
/* XR package launcher: finds Bun and runs the TypeScript CLI entrypoint. */
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

function which(cmd) {
  const probe = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [cmd] : ["-v", cmd];
  const res = spawnSync(probe, args, { encoding: "utf8", shell: process.platform !== "win32" });
  if (res.status !== 0) return null;
  return res.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || null;
}

const bun = which(process.platform === "win32" ? "bun.exe" : "bun") || which("bun");
if (!bun) {
  console.error("XR requires Bun. Install it from https://bun.sh, then run: xr doctor");
  process.exit(127);
}

const entry = resolve(__dirname, "..", "src", "index.ts");
if (!existsSync(entry)) {
  console.error(`XR entrypoint not found: ${entry}`);
  process.exit(1);
}

const res = spawnSync(bun, ["run", entry, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
process.exit(res.status === null ? 1 : res.status);

// Runs the compiled unit tests (out-test/**/*.test.js) with node's built-in runner.
// Finds the files itself, because `node --test <directory>` is not portable across Node versions.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

function findTests(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...findTests(path));
    else if (name.endsWith(".test.js")) out.push(path);
  }
  return out.sort();
}

const files = findTests("out-test");
if (files.length === 0) {
  console.error("No compiled tests found in out-test/. Run `node esbuild.mjs --tests` first.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);

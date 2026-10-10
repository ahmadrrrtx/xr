// Bundles the extension host, the React webview and (with --tests) the unit tests.
//   node esbuild.mjs             → out/extension.js, media/webview.js, media/webview.css
//   node esbuild.mjs --watch     → same, rebuilt on change
//   node esbuild.mjs --tests     → also out-test/**/*.test.js for scripts/run-tests.mjs
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");
const withTests = args.has("--tests");
const production = !watch;

const host = {
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

const webview = {
  entryPoints: ["src/webview/index.tsx"],
  outfile: "media/webview.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome108",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": production ? '"production"' : '"development"' },
  minify: production,
  sourcemap: !production,
  logLevel: "info",
};

function testEntries(dir = "test") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...testEntries(path));
    else if (name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

const tests = withTests
  ? {
      entryPoints: testEntries(),
      outdir: "out-test",
      outbase: "test",
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node18",
      logLevel: "warning",
    }
  : null;

if (watch) {
  const contexts = [await esbuild.context(host), await esbuild.context(webview)];
  for (const ctx of contexts) await ctx.watch();
  console.log("watching…");
} else {
  await Promise.all([esbuild.build(host), esbuild.build(webview)]);
  if (tests) {
    const result = await esbuild.build(tests);
    console.log(`built ${result.outputFiles?.length ?? testEntries().length} test file(s)`);
  }
}


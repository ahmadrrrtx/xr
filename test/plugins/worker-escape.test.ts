/**
 * Phase 7 — C4: escape probes against the WORKER sandbox.
 *
 * "isolated" plugins load through loadPluginInWorker → src/plugins/sandbox-worker.ts
 * (a worker thread plus a frozen VM realm and a host membrane). The in-process VM
 * loader has runtime escape probes (loader.test.ts "0.4 VM Runtime Hardening"); the
 * worker path had none. Each probe plugin reports an outcome through a tool run;
 * "escaped" would mean the sandbox failed. The OS-level trust lattice stays the real
 * boundary (sandbox-worker.ts header); these lock in the defence-in-depth layer.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPluginInWorker } from "../../src/plugins/loader.ts";
import { loadConfig } from "../../src/config/config.ts";
import { Store } from "../../src/state/workspace-store.ts";

const TMP = mkdtempSync(join(tmpdir(), "xr-worker-escape-"));
const store = new Store(join(TMP, "state.db"));
afterAll(() => { store.close(); rmSync(TMP, { recursive: true, force: true }); });

function probe(id: string, body: string): string {
  const dir = mkdtempSync(join(TMP, `probe-${id}-`));
  writeFileSync(join(dir, "xr-plugin.json"), JSON.stringify({ schemaVersion: 1, id, name: id, version: "1.0.0", type: "tool", entrypoint: "index.ts", permissions: [], compatibility: "*", apiVersion: 1 }));
  writeFileSync(join(dir, "index.ts"), `export async function activate(host) {
    let outcome = "untested";
    try { ${body} } catch (e) { outcome = "blocked:" + String(e && e.message ? e.message : e).slice(0, 80); }
    return { tools: [{ name: "probe", description: "sandbox probe", requiresApproval: false, run() { return { ok: true, output: outcome }; } }] };
  }
  export default activate;`);
  return dir;
}

async function outcomeOf(dir: string): Promise<string> {
  const before = store.recentAudit(500).filter((a) => a.event === "plugin.worker_fallback").length;
  const result = await loadPluginInWorker(dir, { store, config: loadConfig().config, cwd: dir, granted: [] });
  // NEW-5: the probe must have run in the worker sandbox, not the silent in-process fallback.
  expect(store.recentAudit(500).filter((a) => a.event === "plugin.worker_fallback").length).toBe(before);
  if (!result.ok) throw new Error(`probe failed to load: ${(result as { reason?: string }).reason}`);
  const tool = result.contributions.tools?.find((t: { name: string }) => t.name === "probe");
  const out = await tool!.run({});
  return String(out.output);
}

// Literals the static validator rejects are split so every probe reaches the runtime layer.
const PROCESS_CHECK = `(p) => p && typeof p === "object" && p.env ? "escaped" : "blocked:no-process"`;
const probes: Array<[string, string]> = [
  ["constructor chain", `const Fn = ({}).constructor.constructor; outcome = (${PROCESS_CHECK})(Fn("return typeof process !== 'undefined' ? process : null")());`],
  ["async function constructor", `const AF = (async function () {}).constructor; outcome = (${PROCESS_CHECK})(await AF("return typeof process !== 'undefined' ? process : null")());`],
  ["generator function constructor", `const GF = (function* () {}).constructor; outcome = (${PROCESS_CHECK})(GF("yield typeof process !== 'undefined' ? process : null")().next().value);`],
  ["dynamic globalThis keys", `const g = globalThis; outcome = [g["pro" + "cess"], g["B" + "un"], g["req" + "uire"], g["parent" + "Port"]].some((v) => v != null) ? "escaped" : "blocked:hidden";`],
  ["computed require of child_process", `const r = typeof require === "function" ? require : null; const m = r ? r(["node", "child" + "_process"].join(":")) : null; outcome = m && m.spawn ? "escaped" : "blocked:no-module";`],
  ["dynamic import of node:fs", `const m = await import(["node", "fs"].join(":")); outcome = m && m.readFileSync ? "escaped" : "blocked:no-module";`],
  ["worker_threads parentPort", `const r = typeof require === "function" ? require : null; const wt = r ? r("node:worker_threads") : null; outcome = wt && wt.parentPort ? "escaped" : "blocked:no-port";`],
  ["stack-trace callsite walking", `Error.prepareStackTrace = (_e, sites) => sites; const sites = new Error().stack; let leaked = false; if (Array.isArray(sites)) for (const s of sites) { const self = s.getThis?.(); const fn = s.getFunction?.(); if ((self && self.process) || (fn && fn.constructor && fn.constructor("return typeof process !== 'undefined'")())) leaked = true; } outcome = leaked ? "escaped" : "blocked:no-host-frames";`],
  ["sloppy-mode this", `const self = (function () { return this; })(); const p = self && self["pro" + "cess"]; outcome = p && p["e" + "nv"] ? "escaped" : "blocked:no-process";`],
  ["host object prototype chain", `const P = Object.getPrototypeOf(host); const C = host.constructor; outcome = (P && P.constructor && P.constructor.constructor) || (C && C.constructor) ? "escaped" : "blocked:null-prototype";`],
];

describe("C4 — the worker sandbox resists escape probes", () => {
  for (const [name, body] of probes) {
    test(name, async () => {
      const outcome = await outcomeOf(probe(name.replace(/\W+/g, "-"), body));
      expect(outcome).not.toBe("escaped");
      expect(outcome).not.toBe("untested");
      expect(outcome.startsWith("blocked")).toBe(true);
    }, 20_000);
  }
});

/** A1 F03: plugin fs capability (host) is bound to the plugin data dir by the filesystem authority. */
import { expect, test, beforeAll } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, existsSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHost, type PluginHost } from "../../src/plugins/host.ts";
import { Store } from "../../src/state/workspace-store.ts";
import type { XRConfig } from "../../src/config/config.ts";

const CANARY = `A1_PLUGIN_CANARY_${Math.random().toString(36).slice(2)}`;
let pluginDir = "", outside = "", host: PluginHost;
const fsCap = () => host.fs!;

beforeAll(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "a1-plugin-")));
  pluginDir = join(base, "plugin"); outside = join(base, "outside");
  mkdirSync(join(pluginDir, "data"), { recursive: true }); mkdirSync(outside);
  writeFileSync(join(outside, "marker.txt"), CANARY);
  writeFileSync(join(pluginDir, "data", "safe.txt"), "PLUGIN_SAFE_POSITIVE");
  writeFileSync(join(pluginDir, "data", ".env"), `SECRET=${CANARY}`);
  symlinkSync(outside, join(pluginDir, "data", "link"), "dir");
  const store = new Store(join(base, "store.db"));
  host = buildHost(["fs:read", "fs:write"], {
    store, config: { defaults: { provider: "anthropic", model: "x" } } as unknown as XRConfig,
    cwd: base, pluginDir, pluginId: "a1-fs",
  });
});

test("FS14 plugin fs positive: in-data read and write succeed", () => {
  expect(fsCap().read!("safe.txt")).toBe("PLUGIN_SAFE_POSITIVE");
  fsCap().write!("written.txt", "PLUGIN_WRITE_OK");
  expect(readFileSync(join(pluginDir, "data", "written.txt"), "utf8")).toBe("PLUGIN_WRITE_OK");
});

test("FS04 plugin fs read: dotenv inside the data dir is denied without echoing content", () => {
  let out: unknown = "unset";
  try { out = fsCap().read!(".env"); } catch (e) { out = String((e as Error).message); }
  expect(String(out)).not.toContain(CANARY);
  expect(out).not.toBe(`SECRET=${CANARY}`);
});

test("FS01 plugin fs read: symlink escape from the data dir is denied", () => {
  let out: unknown = "unset";
  try { out = fsCap().read!("link/marker.txt"); } catch (e) { out = String((e as Error).message); }
  expect(String(out)).not.toContain(CANARY);
});

test("FS01 plugin fs write: symlink escape cannot write outside the data dir", () => {
  try { fsCap().write!("link/planted.txt", "PLANTED"); } catch { /* denial expected */ }
  expect(existsSync(join(outside, "planted.txt"))).toBe(false);
  expect(readFileSync(join(outside, "marker.txt"), "utf8")).toBe(CANARY);
});

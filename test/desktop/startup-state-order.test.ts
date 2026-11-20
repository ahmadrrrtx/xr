/**
 * NEW-7 — the desktop shell aborted (exit 0xC0000409) during startup on the windows-x64 CI journey.
 *
 * Tauri 2.12 builds every configured window (main, hud, orb) BEFORE it runs the app's `setup` hook, and creating the
 * hud/orb webviews pumps messages. The main page can therefore dispatch its bootstrap IPC (`updates_state`, recovery,
 * `db_health`, …) before setup's first line. A direct `state::<T>()` on a type setup has not managed yet panics inside
 * the WebView2 callback, and the process aborts. XR-WIN-BOOT-001 managed these states at the top of setup: too late.
 * The in-memory states such commands read must be managed on the Builder, before any window exists.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHELL = join(import.meta.dir, "../../desktop/src-tauri");
const lib = readFileSync(join(SHELL, "src/lib.rs"), "utf8");
const setupAt = lib.indexOf(".setup(move |app|");
const builderChain = lib.slice(lib.indexOf("pub fn run()"), setupAt);
const setupBody = lib.slice(setupAt);
const BUILDER_STATES = [
  "commands::recovery::RecoveryState",
  "commands::updates::UpdatesState",
  "commands::data_health::DataHealth",
  "commands::workspaces::SpawnState",
  "commands::screenshot::ScreenshotState",
];

test("windows are configured to exist at startup, before setup runs", () => {
  const conf = JSON.parse(readFileSync(join(SHELL, "tauri.conf.json"), "utf8")) as { app: { windows: Array<{ label: string; create?: boolean }> } };
  expect(conf.app.windows.filter((w) => w.create !== false).map((w) => w.label)).toContain("main");
  expect(setupAt).toBeGreaterThan(0);
});

for (const state of BUILDER_STATES) {
  test(`${state.split("::").pop()} is managed on the Builder, never first inside setup`, () => {
    expect(builderChain).toContain(`.manage(${state}::`);
    expect(setupBody.includes(`.manage(${state}::`)).toBe(false);
  });
}

test("every direct state() read in the bootstrap commands is of a Builder-managed type", () => {
  const read = new Set<string>();
  for (const file of ["src/commands/updates.rs", "src/commands/recovery.rs"]) {
    for (const m of readFileSync(join(SHELL, file), "utf8").matchAll(/\.state::<(\w+)>\(\)/g)) read.add(m[1]!);
  }
  expect([...read].sort()).toEqual(["RecoveryState", "UpdatesState"]);
  for (const type of read) expect(BUILDER_STATES.some((s) => s.endsWith(`::${type}`))).toBe(true);
});

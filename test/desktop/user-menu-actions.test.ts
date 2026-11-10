/** Pins the user menu to real actions and the explicitly scoped native quit. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAP_DIR, MAIN_ONLY, permissionId } from "../../scripts/desktop-ipc-acl.ts";
const root = resolve(import.meta.dir, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const permissions = (p: string) => JSON.parse(readFileSync(resolve(CAP_DIR, `ipc-${p}.json`), "utf8")).permissions as string[];

test("user menu navigates to implemented workspaces and updater instead of false success toasts", () => {
  const menu = read("desktop/src/components/layout/UserMenu.tsx");
  expect(menu).toContain("navigate('/workspaces')");
  expect(menu).toContain("navigate('/settings#updates')");
  expect(menu).not.toContain("Workspaces coming in Phase 10");
  expect(menu).not.toContain("You're on the latest version");
  expect(menu).not.toContain("XR 0.2.0");
});

test("Quit XR calls explicit app exit, while the ordinary close still hides the window", () => {
  const menu = read("desktop/src/components/layout/UserMenu.tsx");
  const bridge = read("desktop/src/lib/tauri.ts");
  const window = read("desktop/src-tauri/src/commands/window.rs");
  expect(menu).toContain("quitApp().catch(");
  expect(menu).not.toContain("closeWindow()");
  expect(bridge).toContain("invokeWindowCommand('quit_app')");
  expect(window).toMatch(/fn quit_app[\s\S]*?app\.exit\(0\)/);
  expect(read("desktop/src-tauri/src/lib.rs")).toContain("api.prevent_close()");
  expect(MAIN_ONLY).toContain("quit_app");
  expect(permissions("main")).toContain(permissionId("quit_app"));
  for (const p of ["workspace", "hud", "orb", "theater"]) expect(permissions(p)).not.toContain(permissionId("quit_app"));
});

test("native journey requests explicit quit before checking sidecar containment", () => {
  const journey = read("scripts/journey/desktop-journey.ts");
  const request = journey.indexOf("invoke('quit_app')");
  const containment = journey.indexOf("await engineGone(15_000)", request);
  const sessionDelete = journey.indexOf('await wd("DELETE", `/session/${sid}`)', request);
  expect(request).toBeGreaterThan(0);
  expect(containment).toBeGreaterThan(request);
  expect(sessionDelete).toBeGreaterThan(containment);
});

/**
 * XR-LAUNCH-013 / 014 / 021 — desktop shell hardening, pinned statically.
 *
 * The Tauri crate cannot be built in every CI leg, so the security-relevant
 * wiring is pinned here from source; the Rust behaviour itself is covered by
 * `cargo test` (data_safety.rs, reveal_policy.rs) in desktop-app.yml, and the
 * live ACL by the WebDriver probe in scripts/journey/desktop-journey.ts.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CAP_DIR,
  MAIN_ONLY,
  PRIVILEGED,
  TAURI,
  WINDOWS,
  capabilityJson,
  capabilityPath,
  computeGrants,
  handlerCommands,
  manifestCommands,
  moduleGraph,
  permissionId,
  referencedCommands,
} from "../../scripts/desktop-ipc-acl";

const read = (rel: string) => readFileSync(join(TAURI, rel), "utf8");
const grants = computeGrants();
const grantOf = (id: string) => grants.find((g) => g.spec.id === id)!;
const capPerms = (file: string) => (JSON.parse(readFileSync(join(CAP_DIR, file), "utf8")) as { permissions: (string | { identifier: string })[] }).permissions.map((p) => (typeof p === "string" ? p : p.identifier));

describe("XR-LAUNCH-014 — app ACL is on and every window has an explicit allow-list", () => {
  test("app-commands.rs (the manifest build.rs hands to tauri-build) == generate_handler!", () => {
    const manifest = manifestCommands();
    const handler = handlerCommands();
    expect(new Set(manifest).size).toBe(manifest.length);
    expect([...manifest].sort()).toEqual([...handler].sort());
    expect(manifest.length).toBeGreaterThan(100);
  });

  test("build.rs declares the app manifest from app-commands.rs", () => {
    const b = read("build.rs");
    expect(b).toContain('include!("app-commands.rs")');
    expect(b).toMatch(/AppManifest::new\(\)\s*\.commands\(APP_COMMANDS\)/);
    expect(b).toContain("rerun-if-changed=app-commands.rs");
    expect(b).not.toMatch(/tauri_build::build\(\)/);
  });

  test("generated capability files are current (bun run desktop:ipc-acl --write)", () => {
    for (const g of grants) {
      expect(readFileSync(capabilityPath(g.spec.id), "utf8")).toBe(capabilityJson(g));
    }
  });

  test("hand-written capability files grant no app commands (all app grants are generated)", () => {
    for (const f of readdirSync(CAP_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("ipc-"))) {
      for (const p of capPerms(f)) expect(p.includes(":"), `${f}: ${p}`).toBe(true);
    }
  });

  test("privileged / main-only lists name real commands (typo guard)", () => {
    const known = new Set(manifestCommands());
    for (const c of [...PRIVILEGED, ...MAIN_ONLY]) expect(known.has(c), c).toBe(true);
    expect(PRIVILEGED).not.toContain("append_audit"); // HUD chats must keep writing the audit chain
  });

  test("HUD, Orb and Theater are never granted a privileged command", () => {
    for (const id of ["hud", "orb", "theater"]) {
      const perms = new Set(capPerms(`ipc-${id}.json`));
      for (const c of PRIVILEGED) expect(perms.has(permissionId(c)), `${id}: ${c}`).toBe(false);
    }
    // The minimal surfaces stay minimal.
    expect(grantOf("orb").granted.length).toBeLessThan(15);
    expect(grantOf("theater").granted.length).toBeLessThan(15);
    for (const c of ["import_all_data", "reset_app", "keychain_get", "keychain_set", "reveal_path", "set_devtools_enabled"]) {
      expect(capPerms("ipc-hud.json")).not.toContain(permissionId(c));
    }
  });

  test("workspace windows: main bundle minus main-only data/devtools commands; keychain kept (no insecure fallback)", () => {
    const ws = new Set(capPerms("ipc-workspace.json"));
    for (const c of MAIN_ONLY) expect(ws.has(permissionId(c)), c).toBe(false);
    expect(ws.has(permissionId("keychain_set"))).toBe(true);
    const main = new Set(capPerms("ipc-main.json"));
    for (const c of ["import_all_data", "export_all_data", "reset_app", "keychain_set", "db_health"]) expect(main.has(permissionId(c)), c).toBe(true);
    // Each workspace grant is also a main grant (same bundle, strictly less).
    for (const p of ws) expect(main.has(p), p).toBe(true);
  });

  test("each window's grants ⊆ what its own entry graph references", () => {
    const known = manifestCommands();
    for (const spec of WINDOWS) {
      const reach = referencedCommands(moduleGraph(spec.entry), known);
      for (const p of capPerms(`ipc-${spec.id}.json`)) {
        const cmd = p.replace(/^allow-/, "").replace(/-/g, "_");
        expect(reach.has(cmd), `${spec.id}: ${cmd}`).toBe(true);
      }
    }
  });

  test("the graph walker follows the real wrappers (sanity)", () => {
    const orb = [...moduleGraph("src/orb/main.tsx")].map((f) => f.replace(/\\/g, "/"));
    expect(orb.some((f) => f.endsWith("/src/lib/orb.ts"))).toBe(true);
    const main = [...moduleGraph("src/main.tsx")].map((f) => f.replace(/\\/g, "/"));
    expect(main.some((f) => f.endsWith("/src/lib/settingsApi.ts"))).toBe(true);
    expect(main.some((f) => f.endsWith("/src/integrations/oauthCallback.ts"))).toBe(true);
  });

  test("main-only commands explain themselves in workspace windows instead of failing silently", () => {
    const api = readFileSync(join(TAURI, "../src/lib/settingsApi.ts"), "utf8");
    for (const fn of ["exportAllData", "importAllData", "resetApp"]) {
      const body = api.slice(api.indexOf(`export async function ${fn}(`)).split("\n}\n")[0]!;
      expect(body, fn).toContain("notMainWindow()");
      expect(body, fn).toContain("MAIN_WINDOW_ONLY_MESSAGE");
    }
  });
});

describe("XR-LAUNCH-014 — DevTools off in release, reveal_path confined", () => {
  test("the tauri `devtools` feature is gone; set_devtools_enabled is debug-only", () => {
    const cargo = read("Cargo.toml");
    const tauriDep = cargo.slice(cargo.indexOf("tauri = {"), cargo.indexOf("] }", cargo.indexOf("tauri = {")));
    expect(tauriDep).not.toContain('"devtools"');
    const settings = read("src/commands/settings.rs");
    const fn = settings.slice(settings.indexOf("pub fn set_devtools_enabled"));
    expect(fn.slice(0, 900)).toContain("#[cfg(debug_assertions)]");
    expect(fn.slice(0, 900)).toContain("#[cfg(not(debug_assertions))]");
    const about = readFileSync(join(TAURI, "../src/screens/Settings/tabs/AboutTab.tsx"), "utf8");
    expect(about).toMatch(/import\.meta\.env\.DEV && \(\s*<SettingRow\s+label="Enable developer tools"/);
  });

  test("reveal_path goes through reveal_policy::decide with XR-owned roots only", () => {
    const settings = read("src/commands/settings.rs");
    const fn = settings.slice(settings.indexOf("pub fn reveal_path"), settings.indexOf("pub fn reveal_path") + 700);
    expect(fn).toContain("decide(&path, &reveal_roots(&app))");
    expect(fn).not.toMatch(/open_path\(path,/);
    const roots = settings.slice(settings.indexOf("fn reveal_roots"), settings.indexOf("fn reveal_roots") + 500);
    expect(roots).toContain("crate::crash::xr_home()");
    expect(roots).not.toMatch(/home_dir|document_dir|desktop_dir|download_dir/);
    expect(read("src/lib.rs")).toContain("mod reveal_policy;");
  });
});

describe("XR-LAUNCH-013 — OAuth deep link reaches the running instance", () => {
  test("single-instance is built with its deep-link feature and registered before the deep-link plugin", () => {
    expect(read("Cargo.toml")).toMatch(/tauri-plugin-single-instance = \{ version = "2", features = \["deep-link"\] \}/);
    const lock = read("Cargo.lock");
    const entry = lock.slice(lock.indexOf('name = "tauri-plugin-single-instance"'), lock.indexOf("[[package]]", lock.indexOf('name = "tauri-plugin-single-instance"')));
    expect(entry).toContain('"tauri-plugin-deep-link"');
    const lib = read("src/lib.rs");
    expect(lib.indexOf("tauri_plugin_single_instance::init")).toBeGreaterThan(0);
    expect(lib.indexOf("tauri_plugin_single_instance::init")).toBeLessThan(lib.indexOf("tauri_plugin_deep_link::init()"));
  });

  test("unpackaged builds (AppImage, dev) register the xr scheme at runtime", () => {
    const lib = read("src/lib.rs");
    expect(lib).toContain('std::env::var_os("APPIMAGE")');
    expect(lib).toContain("app.deep_link().register_all()");
    const conf = JSON.parse(read("tauri.conf.json")) as { plugins: { "deep-link": { desktop: { schemes: string[] } } } };
    expect(conf.plugins["deep-link"].desktop.schemes).toEqual(["xr"]);
    expect(capPerms("default.json")).toContain("deep-link:default"); // getCurrent() for the cold start
  });
});

describe("XR-LAUNCH-021 — no panics on a damaged database; WAL-safe import/export", () => {
  test("no `.expect` on the xr.db open path in any init", () => {
    for (const rel of ["src/commands/workspaces/db.rs", "src/shield/mod.rs", "src/budget/mod.rs", "src/commands/chat.rs"]) {
      const src = read(rel);
      const init = src.slice(src.indexOf("fn init("), src.indexOf("fn init(") + 1600);
      expect(init, rel).toContain("crate::data_safety::open_shared_db(");
      expect(init, rel).not.toMatch(/\.expect\("(open xr\.db|create app data dir|tauri app_data_dir must resolve|enable WAL)/);
    }
  });

  test("setup applies a staged import + integrity preflight BEFORE the first connection", () => {
    const lib = read("src/lib.rs");
    const startup = lib.indexOf("commands::data_health::startup(");
    expect(startup).toBeGreaterThan(0);
    expect(startup).toBeLessThan(lib.indexOf("commands::chat::init(app)?"));
    expect(lib).toContain("commands::data_health::db_health,");
  });

  test("import stages + validates; export snapshots; nothing unzips over live data", () => {
    const settings = read("src/commands/settings.rs");
    expect(settings).toContain("crate::data_safety::stage_import(&zip_path, &data)?");
    expect(settings).toContain("crate::data_safety::write_export(&data, &dest)?");
    expect(settings).not.toContain("archive.extract(&data)");
    const ds = read("src/data_safety.rs");
    for (const t of [
      "import_over_a_live_wal_db_loses_nothing_and_keeps_a_backup",
      "corrupt_or_hostile_archives_are_errors_and_leave_live_data_alone",
      "export_snapshot_includes_rows_still_in_the_wal",
      "preflight_quarantines_a_db_with_damaged_pages",
    ]) expect(ds).toContain(`fn ${t}()`);
  });

  test("the UI shows import/export errors instead of 'cancelled'", () => {
    const tab = readFileSync(join(TAURI, "../src/screens/Settings/tabs/GeneralTab.tsx"), "utf8");
    expect(tab).toContain("toast.error('Import failed — your data is unchanged'");
    expect(tab).toContain("toast.error('Export failed'");
  });
});

// Source wiring assertion complements std-only executed validator tests, not an
// OS keychain integration claim.
test("legacy native credential IPC cannot address arbitrary OS-store accounts", () => {
  const source = read("src/commands/settings.rs");
  for (const fn of ["keychain_get", "keychain_delete"]) {
    const body = source.slice(source.indexOf(`pub fn ${fn}(`)).split("\n}\n")[0]!;
    expect(body).toContain("crate::legacy_credentials::validate_scope(&service, &account)?");
  }
  const write = source.slice(source.indexOf("pub fn keychain_set(")).split("\n}\n")[0]!;
  expect(write).toContain("Legacy OS credential writes are disabled");
  expect(write).not.toContain("set_password");
});

// XR-LAUNCH-014: the app command list (single source, pinned by
// test/desktop/ipc-acl.test.ts against `generate_handler!`).
include!("app-commands.rs");

fn main() {
    // Phase 14 — the shell resolves its sidecar by the EXACT target triple
    // Tauri uses for externalBin naming (xr-engine-<triple>[.exe]).
    println!(
        "cargo:rustc-env=TARGET_TRIPLE={}",
        std::env::var("TARGET").unwrap()
    );
    println!("cargo:rerun-if-changed=app-commands.rs");
    // XR-LAUNCH-014: declaring the app manifest turns the app ACL on. Every
    // command is then denied unless the calling window's capability grants
    // it (capabilities/ipc-*.json) — HUD/Orb/Theater can no longer reach
    // import/reset/keychain/devtools.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("tauri-build failed");
}

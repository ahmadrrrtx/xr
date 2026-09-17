fn main() {
    // Phase 4 · D-02 — the shell resolves its sidecar by the EXACT target
    // triple Tauri uses for externalBin naming (xr-engine-<triple>[.exe]).
    println!("cargo:rustc-env=TARGET_TRIPLE={}", std::env::var("TARGET").unwrap());
    tauri_build::build()
}

/*
 * Phase 3 — hardware / runtime detection commands.
 *
 * `detect_system` uses `sysinfo` for OS, CPU brand/cores and total RAM.
 * GPU + microphone are probed webview-side (WebGPU adapter info + media
 * devices) and merged in the frontend — see desktop/src/lib/detect.ts.
 *
 * `detect_ollama` probes the local Ollama daemon over HTTP (ureq, 1s
 * timeout): GET /api/tags for installed models. No shell-outs, no bundling.
 */
use serde::Serialize;
use sysinfo::System;

const OLLAMA_BASE: &str = "http://127.0.0.1:11434";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub total_memory_gb: f64,
}

#[tauri::command]
pub fn detect_system() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let os = System::long_os_version()
        .or_else(System::name)
        .unwrap_or_else(|| "Unknown OS".into());
    let os_version = System::os_version().unwrap_or_default();
    let arch = std::env::consts::ARCH.to_string();
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| format!("{} cores", sys.cpus().len()));
    let cpu_cores = sys.cpus().len();
    let total_memory_gb = (sys.total_memory() as f64) / (1024.0 * 1024.0 * 1024.0);

    SystemInfo {
        os,
        os_version,
        arch,
        cpu_brand,
        cpu_cores,
        // Round to 0.1 GB — display precision, not a spec sheet.
        total_memory_gb: (total_memory_gb * 10.0).round() / 10.0,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    pub size_gb: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaInfo {
    pub installed: bool,
    pub version: Option<String>,
    pub models: Vec<OllamaModel>,
}

/// GET /api/tags with a 1s connect+read timeout. Any failure (daemon not
/// running, not installed) maps to `installed: false` — never an error.
#[tauri::command]
pub fn detect_ollama() -> OllamaInfo {
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(1))
        .build();

    let tags_url = format!("{OLLAMA_BASE}/api/tags");
    let tags = match agent.get(&tags_url).call() {
        Ok(resp) => match resp.into_json::<serde_json::Value>() {
            Ok(v) => v,
            Err(_) => return OllamaInfo { installed: false, version: None, models: vec![] },
        },
        Err(_) => return OllamaInfo { installed: false, version: None, models: vec![] },
    };

    let version_url = format!("{OLLAMA_BASE}/api/version");
    let version = agent
        .get(&version_url)
        .call()
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok())
        .and_then(|v| v.get("version").and_then(|s| s.as_str()).map(String::from));

    let mut models = vec![];
    if let Some(list) = tags.get("models").and_then(|m| m.as_array()) {
        for m in list {
            let name = m
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default()
                .to_string();
            let size_gb = m
                .get("size")
                .and_then(|s| s.as_u64())
                .map(|s| ((s as f64 / (1024.0 * 1024.0 * 1024.0)) * 10.0).round() / 10.0)
                .unwrap_or(0.0);
            if !name.is_empty() {
                models.push(OllamaModel { name, size_gb });
            }
        }
    }

    OllamaInfo { installed: true, version, models }
}

/*
 * Phase 10 — git helpers.
 *
 * The brief says: shell out to the system `git` (no git2 dependency — it can
 * be added later for in-app repo status, e.g. Phase 29). Progress is parsed
 * from `git clone --progress` stderr and streamed to the caller's window as
 * `workspace:clone-progress` events.
 */
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Command;

/// Progress is reported through this closure (the caller owns the AppHandle
/// and the event emission), so this module stays testable without a running
/// Tauri window and needs no tauri import.
type ProgressFn = Box<dyn Fn(u8, &str) + Send>;

pub fn check_git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|mut c| c.wait().map(|s| s.success()).unwrap_or(false))
        .unwrap_or(false)
}

/// Clone `url` into `dest`. Returns the detected stack on success.
pub fn clone_git_workspace(
    url: &str,
    dest: &str,
    on_progress: ProgressFn,
) -> Result<Vec<String>, String> {
    if !check_git_available() {
        return Err("git was not found on this machine — install it and try again".into());
    }
    // Fast reject: real git URLs never contain whitespace; git's own error
    // for "https://github.com/ x/y" would just be confusing.
    if url.chars().any(char::is_whitespace) {
        return Err("That URL has a space in it — paste the full address without spaces".into());
    }
    let dest = Path::new(dest);
    if dest.exists() && dest.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err("That folder is not empty — pick a different path".into());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut child = Command::new("git")
        .args(["clone", "--progress", "--"])
        .arg(url)
        .arg(dest)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start git: {e}"))?;
    let stderr = child.stderr.take().expect("stderr piped");
    let reader = BufReader::new(stderr);

    on_progress(0, "cloning");
    let mut last_pct: u8 = 0;
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        // "Receiving objects:  42% (123/292), 1.2 MiB | 900.00 KiB/s"
        if let Some(p) = parse_receiving_percent(&line) {
            // Receiving maps to 5..85 so "done" reads as a real jump.
            let mapped: u16 = 5 + p as u16 * 80 / 100;
            last_pct = mapped as u8;
            on_progress(last_pct, "receiving");
        } else if line.contains("Resolving deltas") && last_pct < 85 {
            on_progress(85, "resolving");
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("git exited: {e}"))?;
    if !status.success() {
        // The most useful line for a user is the "fatal: …" one.
        let msg = friendly_clone_error(url);
        return Err(msg);
    }

    on_progress(100, "done");
    Ok(detect_stack(dest))
}

fn friendly_clone_error(url: &str) -> String {
    // git's own stderr was consumed above; keep the message short + honest.
    if !check_git_available() {
        return "git was not found on this machine".into();
    }
    format!("Clone failed for {url} — check the URL and your network, then retry.")
}

/// `Receiving objects:  20% (1/5), …` → 20
fn parse_receiving_percent(line: &str) -> Option<u8> {
    let start = line.find("Receiving objects:")? + "Receiving objects:".len();
    let rest = line[start..].trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() || !rest.get(digits.len()..).map(|s| s.starts_with('%')).unwrap_or(false)
    {
        return None;
    }
    digits.parse::<u8>().ok()
}

/// Stack detection from marker files (brief: run after clone).
pub fn detect_stack(root: &Path) -> Vec<String> {
    let mut out: Vec<&str> = Vec::new();
    let has = |p: &str| root.join(p).exists();

    if has("package.json") {
        out.push("web");
        if has("vite.config.ts") || has("vite.config.js") {
            out.push("vite");
        }
        if has("tsconfig.json") || has("src/App.tsx") {
            out.push("ts");
        }
    }
    if has("requirements.txt") || has("pyproject.toml") || has("main.py") {
        out.push("python");
    }
    if has("Cargo.toml") {
        out.push("rust");
    }
    if has("go.mod") {
        out.push("go");
    }
    if has("outline.md") || has("sources") {
        out.push("research");
    }
    if has(".git") {
        out.push("git");
    }
    out.into_iter().take(4).map(String::from).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_receiving_percent() {
        assert_eq!(
            parse_receiving_percent("Receiving objects:  20% (1/5), 10.00 KiB | 10.00 KiB/s"),
            Some(20)
        );
        assert_eq!(
            parse_receiving_percent("Receiving objects: 100% (5/5), done."),
            Some(100)
        );
        assert_eq!(parse_receiving_percent("Cloning into 'x'..."), None);
    }

    #[test]
    fn stack_detection_finds_markers() {
        let dir = std::env::temp_dir().join(format!("xr-stack-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(dir.join("src"));
        std::fs::write(dir.join("package.json"), "{}").unwrap();
        std::fs::write(dir.join("vite.config.ts"), "").unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        let stack = detect_stack(&dir);
        assert_eq!(stack, vec!["web", "vite", "git"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scaffold_writes_files() {
        use super::super::scaffold::scaffold;
        let dir = std::env::temp_dir().join(format!("xr-scaffold-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let files = scaffold(dir.to_str().unwrap(), "web", "Demo").unwrap();
        assert!(files.iter().any(|f| f == "package.json"));
        assert!(files.iter().any(|f| f == "src/App.tsx"));
        assert!(std::fs::read_to_string(dir.join("README.md")).unwrap().contains("bun install"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

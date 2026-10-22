/*
 * XR-LAUNCH-014 — `reveal_path` policy (pure, std only; unit-tested).
 *
 * The webview may only ask the OS to open/reveal paths XR owns: the app's
 * data/config/log/cache dirs and the engine home (`XR_HOME` or `~/.xr`).
 * Both sides are canonicalized, so `..`, symlinks and junctions cannot walk
 * out of a root. Directories open in the file manager; files open in their
 * default application ONLY for inert document types (settings.json, logs);
 * anything else is revealed in its folder, never launched — a webview bug
 * must not be able to execute a binary via the OS opener.
 */
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum RevealAction {
    /// Open a directory in the file manager.
    OpenDir(PathBuf),
    /// Open an inert document in its default application.
    OpenFile(PathBuf),
    /// Select the item in its parent folder without launching it.
    RevealInDir(PathBuf),
}

/// Extensions that are safe to hand to the OS default application.
const INERT_EXTENSIONS: &[&str] = &[
    "json", "jsonl", "txt", "log", "md", "toml", "yaml", "yml", "csv",
];

pub fn decide(path: &str, roots: &[PathBuf]) -> Result<RevealAction, String> {
    if path.trim().is_empty() {
        return Err("No path to open.".into());
    }
    let target = Path::new(path);
    if !target.is_absolute() {
        return Err("Only absolute paths can be opened.".into());
    }
    let canonical = target
        .canonicalize()
        .map_err(|_| "That path does not exist.".to_string())?;
    let inside = roots
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|root| canonical.starts_with(&root));
    if !inside {
        return Err("XR only opens its own folders (app data, logs, the XR home). Use your file manager for other locations.".into());
    }
    if canonical.is_dir() {
        return Ok(RevealAction::OpenDir(canonical));
    }
    let inert = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| INERT_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if inert {
        Ok(RevealAction::OpenFile(canonical))
    } else {
        Ok(RevealAction::RevealInDir(canonical))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "xr-reveal-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn owned_dirs_and_inert_files_open() {
        let root = tmp("root");
        fs::write(root.join("settings.json"), b"{}").unwrap();
        fs::create_dir_all(root.join("logs")).unwrap();
        let roots = vec![root.clone()];
        assert!(matches!(
            decide(root.join("logs").to_str().unwrap(), &roots),
            Ok(RevealAction::OpenDir(_))
        ));
        assert!(matches!(
            decide(root.join("settings.json").to_str().unwrap(), &roots),
            Ok(RevealAction::OpenFile(_))
        ));
    }

    #[test]
    fn executables_inside_a_root_are_revealed_not_launched() {
        let root = tmp("exe");
        for name in [
            "payload.exe",
            "run.sh",
            "evil.app",
            "x.desktop",
            "noext",
            "a.JSON.bat",
        ] {
            fs::write(root.join(name), b"x").unwrap();
            let got = decide(
                root.join(name).to_str().unwrap(),
                std::slice::from_ref(&root),
            )
            .unwrap();
            assert!(
                matches!(got, RevealAction::RevealInDir(_)),
                "{name}: {got:?}"
            );
        }
    }

    #[test]
    fn paths_outside_every_root_are_refused() {
        let root = tmp("in");
        let outside = tmp("out");
        fs::write(outside.join("notes.txt"), b"x").unwrap();
        let err = decide(outside.join("notes.txt").to_str().unwrap(), &[root]).unwrap_err();
        assert!(err.contains("only opens its own folders"));
    }

    #[test]
    fn dot_dot_cannot_escape_a_root() {
        let base = tmp("dd");
        let root = base.join("app");
        fs::create_dir_all(&root).unwrap();
        fs::write(base.join("secret.txt"), b"x").unwrap();
        let sneaky = format!("{}/../secret.txt", root.display());
        assert!(decide(&sneaky, &[root]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape_a_root() {
        let root = tmp("sl");
        let outside = tmp("sl-out");
        fs::write(outside.join("id_rsa"), b"x").unwrap();
        std::os::unix::fs::symlink(outside.join("id_rsa"), root.join("link.txt")).unwrap();
        assert!(decide(root.join("link.txt").to_str().unwrap(), &[root]).is_err());
    }

    #[test]
    fn relative_empty_and_missing_paths_are_refused() {
        let root = tmp("rel");
        assert!(decide("", std::slice::from_ref(&root)).is_err());
        assert!(decide("settings.json", std::slice::from_ref(&root)).is_err());
        assert!(decide(
            root.join("missing.json").to_str().unwrap(),
            std::slice::from_ref(&root)
        )
        .is_err());
    }

    #[test]
    fn a_missing_root_grants_nothing() {
        let real = tmp("real");
        fs::write(real.join("a.txt"), b"x").unwrap();
        let ghost = real.join("does-not-exist");
        assert!(decide(real.join("a.txt").to_str().unwrap(), &[ghost]).is_err());
    }
}

//! Platform trash, never permanent deletion. GIO preserves Linux .trashinfo
//! metadata without trash-rs's unmaintained chrono dependency. Windows/macOS
//! keep the same native trash-rs backends and Windows COM initialization mode.

pub fn delete(path: impl AsRef<std::path::Path>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use gio::prelude::FileExt;
        gio::File::for_path(path.as_ref())
            .trash(None::<&gio::Cancellable>)
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        trash::DEFAULT_TRASH_CTX
            .delete(path)
            .map_err(|error| error.to_string())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::delete;
    use std::{fs, path::Path, process::Command, time::SystemTime};

    // GIO caches XDG paths process-wide. Set them only on a child process,
    // never by racing environment mutations against other shell unit tests.
    fn isolated(test: &str, case: impl FnOnce(&Path)) {
        const ROOT: &str = "XR_PLATFORM_TRASH_TEST_ROOT";
        if let Some(root) = std::env::var_os(ROOT) {
            case(Path::new(&root));
            return;
        }
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("xr-platform-trash-{}-{unique}", std::process::id()));
        fs::create_dir_all(root.join("home")).unwrap();
        fs::create_dir_all(root.join("data")).unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", test, "--nocapture", "--test-threads=1"])
            .env(ROOT, &root)
            .env("HOME", root.join("home"))
            .env("XDG_DATA_HOME", root.join("data"))
            .env("GIO_USE_VFS", "local")
            .env_remove("DBUS_SESSION_BUS_ADDRESS")
            .output();
        // Clean the fixture even when a child assertion failed.
        let cleanup = fs::remove_dir_all(&root);
        let output = output.unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success(),
            "{stdout}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            stdout.contains("1 passed"),
            "child must actually run the requested test: {stdout}"
        );
        cleanup.unwrap();
    }

    #[test]
    fn linux_trash_preserves_metadata_and_payload() {
        isolated(
            "platform_trash::tests::linux_trash_preserves_metadata_and_payload",
            |root| {
                let workspace = root.join("workspace notes#");
                fs::create_dir_all(&workspace).unwrap();
                fs::write(workspace.join("notes.txt"), "recoverable workspace").unwrap();
                delete(&workspace).unwrap();
                assert!(!workspace.exists());
                let trash = root.join("data/Trash");
                assert_eq!(
                    fs::read_to_string(trash.join("files/workspace notes#/notes.txt")).unwrap(),
                    "recoverable workspace"
                );
                let info =
                    fs::read_to_string(trash.join("info/workspace notes#.trashinfo")).unwrap();
                assert!(info.starts_with("[Trash Info]\n"));
                let encoded = info
                    .lines()
                    .find_map(|line| line.strip_prefix("Path="))
                    .unwrap();
                let restored = gio::glib::uri_unescape_string(encoded, None::<&str>).unwrap();
                assert_eq!(Path::new(restored.as_str()), workspace);
                let date = info
                    .lines()
                    .find_map(|line| line.strip_prefix("DeletionDate="))
                    .unwrap();
                assert_eq!(date.len(), 19);
                gio::glib::DateTime::from_iso8601(&format!("{date}Z"), None).unwrap();

                // Trashing a later workspace with the same name must not overwrite
                // the first recoverable copy or its metadata.
                fs::create_dir_all(&workspace).unwrap();
                fs::write(workspace.join("notes.txt"), "second workspace").unwrap();
                delete(&workspace).unwrap();
                let mut contents: Vec<_> = fs::read_dir(trash.join("files"))
                    .unwrap()
                    .map(|entry| {
                        fs::read_to_string(entry.unwrap().path().join("notes.txt")).unwrap()
                    })
                    .collect();
                contents.sort();
                assert_eq!(contents, ["recoverable workspace", "second workspace"]);
                assert_eq!(fs::read_dir(trash.join("info")).unwrap().count(), 2);
            },
        );
    }

    #[test]
    fn linux_trash_does_not_follow_symlink_targets() {
        isolated(
            "platform_trash::tests::linux_trash_does_not_follow_symlink_targets",
            |root| {
                let target = root.join("kept.txt");
                let link = root.join("shortcut");
                fs::write(&target, "keep the target").unwrap();
                std::os::unix::fs::symlink(&target, &link).unwrap();
                delete(&link).unwrap();
                assert!(fs::symlink_metadata(&link).is_err());
                assert_eq!(fs::read_to_string(&target).unwrap(), "keep the target");
                let trashed = root.join("data/Trash/files/shortcut");
                assert!(fs::symlink_metadata(&trashed)
                    .unwrap()
                    .file_type()
                    .is_symlink());
                assert_eq!(fs::read_link(&trashed).unwrap(), target);
            },
        );
    }

    #[test]
    fn linux_trash_failure_never_falls_back_to_permanent_deletion() {
        isolated(
            "platform_trash::tests::linux_trash_failure_never_falls_back_to_permanent_deletion",
            |root| {
                fs::write(root.join("data/Trash"), "not a trash directory").unwrap();
                let source = root.join("keep.txt");
                fs::write(&source, "still recoverable").unwrap();
                assert!(delete(&source).is_err());
                assert_eq!(fs::read_to_string(&source).unwrap(), "still recoverable");
                assert!(delete(root.join("does-not-exist")).is_err());
            },
        );
    }
}

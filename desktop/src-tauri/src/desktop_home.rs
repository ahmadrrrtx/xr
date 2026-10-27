//! Desktop engine/crash state is independent from the CLI. No implicit import
//! from XR_HOME, no global CLI executable, and no shell/profile mutation.
use std::ffi::OsStr;
use std::path::PathBuf;

pub fn resolve_from(override_home: Option<&OsStr>, user_home: Option<&OsStr>) -> Result<PathBuf, String> {
    if let Some(value) = override_home {
        let path = PathBuf::from(value);
        if !path.is_absolute() { return Err("XR_DESKTOP_HOME must be an absolute path".into()); }
        return Ok(path);
    }
    let home = user_home.map(PathBuf::from).filter(|p| p.is_absolute())
        .ok_or("Cannot resolve desktop home; set an absolute XR_DESKTOP_HOME")?;
    Ok(home.join(".xr-desktop"))
}

pub fn resolve() -> Result<PathBuf, String> {
    let explicit = std::env::var_os("XR_DESKTOP_HOME");
    #[allow(deprecated)]
    let home = std::env::home_dir();
    resolve_from(explicit.as_deref(), home.as_deref().map(|p| p.as_os_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_is_independent_and_does_not_create_or_copy_anything() {
        let user = std::env::temp_dir().join("xr-home-resolution-unit");
        assert_eq!(resolve_from(None, Some(user.as_os_str())).unwrap(), user.join(".xr-desktop"));
        assert!(!user.exists());
    }
    #[test]
    fn explicit_desktop_home_wins_without_needing_a_cli_home() {
        let expected = std::env::temp_dir().join("xr-explicit-home-unit");
        assert_eq!(resolve_from(Some(expected.as_os_str()), None).unwrap(), expected);
    }
    #[test]
    fn missing_or_relative_homes_fail_closed_instead_of_using_cwd() {
        assert!(resolve_from(None, None).is_err());
        assert!(resolve_from(Some(OsStr::new("relative")), None).is_err());
        assert!(resolve_from(None, Some(OsStr::new("relative"))).is_err());
    }
}

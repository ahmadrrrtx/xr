/*
 * Screenshot-and-ask (Phase 27).
 *
 * ⌘⇧X (Ctrl+Shift+X elsewhere) captures a screen region and hands the file to
 * the webview, which opens a new chat with the image attached. The shell does
 * the capture because region selection is an OS affordance, not a web one.
 *
 * Per platform, in preference order:
 *   macOS    `screencapture -i`        (the system's own masked selector)
 *   Windows  PowerShell + .NET overlay (rubber-band region, dimmed backdrop)
 *   Linux    `grim` → `gnome-screenshot -a` → `spectacle -r` → `maim -s`
 *            → `scrot -s` → `import`  (whichever exists; Wayland first if the
 *            session is Wayland, but `grim` is tried before the X11 tools)
 *
 * Two rules the code holds to:
 *   · A cancelled capture is NOT an error. The user pressed Esc; the shell says
 *     so and shows nothing.
 *   · A missing tool is an error the user can act on, and on Wayland without a
 *     portal that error names the fix (install grim / enable the portal)
 *     instead of "screenshot failed".
 *
 * Windows processes are spawned with CREATE_NO_WINDOW (invariant W-1: no
 * console flash, ever).
 */
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// Tools to try, in order, with the argument shape that means "pick a region".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CaptureCandidate {
    /// Executable name looked up on PATH (or an absolute path when the tool
    /// only ever lives there).
    pub program: &'static str,
    /// Arguments before the output path.
    pub args: &'static [&'static str],
    /// How the tool reports its output: every candidate here takes the file
    /// path as the last argument, so the runner only appends it.
    pub writes_to_path: bool,
}

/// What a platform's capture should try, given the session type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CapturePlan {
    pub os: &'static str,
    pub wayland: bool,
    pub candidates: Vec<CaptureCandidate>,
}

const MACOS_TOOL: CaptureCandidate = CaptureCandidate {
    // -i: interactive selection; -x: silent; -t png: predictable format.
    program: "/usr/sbin/screencapture",
    args: &["-i", "-x", "-t", "png"],
    writes_to_path: true,
};

/// The Linux tools, best-region-selector first.
const LINUX_TOOLS: &[CaptureCandidate] = &[
    CaptureCandidate { program: "grim", args: &["-t", "png"], writes_to_path: true },
    CaptureCandidate { program: "gnome-screenshot", args: &["-a", "-f"], writes_to_path: true },
    CaptureCandidate { program: "spectacle", args: &["-r", "-b", "-n", "-o"], writes_to_path: true },
    CaptureCandidate { program: "maim", args: &["-s"], writes_to_path: true },
    CaptureCandidate { program: "scrot", args: &["-s"], writes_to_path: true },
];

/// Every tool in the list writes to the path appended last, which is what makes
/// one runner enough. Tools whose region flags differ (`spectacle`, `import`)
/// stay out rather than being special-cased into the runner.
const WAYLAND_TOOLS: &[CaptureCandidate] = &[
    CaptureCandidate { program: "grim", args: &["-t", "png"], writes_to_path: true },
    CaptureCandidate { program: "gnome-screenshot", args: &["-a", "-f"], writes_to_path: true },
];

/// The capture plan for a platform. `wayland` only matters on Linux.
pub fn plan_for(os: &str, wayland: bool) -> CapturePlan {
    match os {
        "macos" => CapturePlan { os: "macos", wayland: false, candidates: vec![MACOS_TOOL] },
        "windows" => CapturePlan { os: "windows", wayland: false, candidates: Vec::new() },
        _ => CapturePlan {
            os: "linux",
            wayland,
            candidates: if wayland { WAYLAND_TOOLS.to_vec() } else { LINUX_TOOLS.to_vec() },
        },
    }
}

/// True when `program` can be spawned (absolute path exists, or a bare name
/// resolves on PATH). PATH is consulted by hand rather than via `which` so this
/// works identically on all three platforms and in tests.
pub fn tool_available(program: &str) -> bool {
    if program.contains('/') || program.contains('\\') {
        return Path::new(program).is_file();
    }
    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path_var).any(|dir| {
        if dir.join(program).is_file() {
            return true;
        }
        #[cfg(windows)]
        {
            // Windows resolves `foo` to `foo.exe`; PATH lookup by hand has to
            // do the same or every tool looks missing.
            if dir.join(format!("{program}.exe")).is_file() {
                return true;
            }
        }
        false
    })
}

/// The first candidate that exists on this machine.
pub fn first_available(plan: &CapturePlan) -> Option<CaptureCandidate> {
    plan.candidates.iter().find(|c| tool_available(c.program)).cloned()
}

/// Where a capture lands. `dir` normally comes from
/// [`crate::screenshot::scratch_dir`].
pub fn output_path(dir: &Path, stamp_ms: u128) -> PathBuf {
    dir.join(format!("xr-shot-{stamp_ms}.png"))
}

/// `$TMPDIR/xr-shots` (created on demand) — captures are transient by design:
/// the webview attaches the image to the message, then the shell deletes it.
pub fn scratch_dir() -> PathBuf {
    std::env::temp_dir().join("xr-shots")
}

/// Result of one capture attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOutcome {
    /// Path to the PNG when the capture succeeded.
    pub path: Option<String>,
    /// True when the user dismissed the selector (Esc) — not a failure.
    pub cancelled: bool,
    /// Which tool did the work ("screencapture", "grim", "powershell", …).
    pub tool: String,
    /// Actionable message when nothing could be captured.
    pub error: Option<String>,
}

impl CaptureOutcome {
    fn ok(path: PathBuf, tool: &str) -> Self {
        CaptureOutcome { path: Some(path.display().to_string()), cancelled: false, tool: tool.into(), error: None }
    }
    fn cancelled(tool: &str) -> Self {
        CaptureOutcome { path: None, cancelled: true, tool: tool.into(), error: None }
    }
}

/// The help text shown when no capture tool exists. Naming the fix is the whole
/// point: "Wayland has no screencapture" is not actionable, this is.
pub fn missing_tool_help(os: &str, wayland: bool) -> String {
    match (os, wayland) {
        ("macos", _) => "Region capture needs /usr/sbin/screencapture, which ships with macOS. If it is missing, run: sudo chmod +x /usr/sbin/screencapture".into(),
        ("windows", _) => "Region capture needs PowerShell with .NET (adds a hidden selection overlay). It ships with Windows; if it is unavailable, check that powershell.exe is on PATH.".into(),
        ("linux", true) => "Wayland session without a capture tool. Install one of: grim (wlroots compositors), gnome-screenshot (GNOME), or enable the desktop portal (xdg-desktop-portal) so the file chooser can snapshot a region. XR does not screenshot through the portal yet.".into(),
        _ => "No region-capture tool found. Install one of: maim, scrot, gnome-screenshot or spectacle (KDE).".into(),
    }
}

/// Run the platform capture. Blocking by design: the caller runs it off the
/// UI thread. `wayland` is read from the environment by the caller so this
/// stays testable.
pub fn capture(plan: &CapturePlan, dir: &Path, stamp_ms: u128) -> CaptureOutcome {
    if std::fs::create_dir_all(dir).is_err() {
        return CaptureOutcome {
            path: None,
            cancelled: false,
            tool: "none".into(),
            error: Some(format!("could not create the scratch directory {}", dir.display())),
        };
    }
    let out_path = output_path(dir, stamp_ms);

    match plan.os {
        "windows" => capture_windows(&out_path),
        _ => match first_available(plan) {
            Some(tool) => run_tool(&tool, &out_path),
            None => CaptureOutcome {
                path: None,
                cancelled: false,
                tool: "none".into(),
                error: Some(missing_tool_help(plan.os, plan.wayland)),
            },
        },
    }
}

/// Spawn one of the path-taking tools and interpret its exit code.
fn run_tool(tool: &CaptureCandidate, out_path: &Path) -> CaptureOutcome {
    let mut cmd = Command::new(tool.program);
    cmd.args(tool.args).arg(out_path);
    apply_no_window(&mut cmd);

    match cmd.status() {
        Ok(status) => {
            if out_path.is_file() {
                // A tool that exits non-zero but wrote a file (some do when the
                // user resizes during capture) still produced an image: use it.
                CaptureOutcome::ok(out_path.to_path_buf(), tool_name(tool.program))
            } else if status.success() {
                CaptureOutcome {
                    path: None,
                    cancelled: false,
                    tool: tool_name(tool.program).into(),
                    error: Some(format!("{} exited cleanly but wrote no image", tool.program)),
                }
            } else {
                // No file + non-zero = the user pressed Esc. Every tool in the
                // list behaves this way, and calling it an error would nag.
                CaptureOutcome::cancelled(tool_name(tool.program))
            }
        }
        Err(e) => CaptureOutcome {
            path: None,
            cancelled: false,
            tool: tool_name(tool.program).into(),
            error: Some(format!("could not run {}: {e}", tool.program)),
        },
    }
}

fn tool_name(program: &str) -> &str {
    program.rsplit(['/', '\\']).next().unwrap_or(program)
}

/// Hide the console window a console program would otherwise flash (W-1).
/// A no-op off Windows, where there is no console to hide.
#[cfg_attr(not(windows), allow(unused_variables))]
fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// The PowerShell region selector: a translucent full-screen form with a
/// rubber band, copied to the clipboard and written to `out_path` on release.
/// Esc closes the form without writing a file.
fn windows_script(out_path: &Path) -> String {
    let escaped = out_path.display().to_string().replace('\'', "''");
    format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;
public class XRSnip : Form {{
  private Point start; private bool dragging;
  public Rectangle Region {{ get; private set; }}
  public XRSnip() {{
    FormBorderStyle = FormBorderStyle.None;
    StartPosition = FormStartPosition.Manual;
    Bounds = SystemInformation.VirtualScreen;
    TopMost = true; ShowInTaskbar = false; Opacity = 0.30; BackColor = Color.Black;
    Cursor = Cursors.Cross; DoubleBuffered = true;
    KeyPreview = true;
    KeyDown += (s, e) => {{ if (e.KeyCode == Keys.Escape) {{ Region = Rectangle.Empty; Close(); }} }};
    MouseDown += (s, e) => {{ start = e.Location; dragging = true; }};
    MouseMove += (s, e) => {{ if (dragging) {{ var r = Normalize(start, e.Location); Region = r; Invalidate(); }} }};
    MouseUp += (s, e) => {{ if (dragging) {{ dragging = false; Region = Normalize(start, e.Location); Close(); }} }};
  }}
  private static Rectangle Normalize(Point a, Point b) {{
    return Rectangle.FromLTRB(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Max(a.X, b.X), Math.Max(a.Y, b.Y));
  }}
  protected override void OnShown(EventArgs e) {{ base.OnShown(e); Activate(); Focus(); }}
}}
$snip = New-Object XRSnip
[void]$snip.ShowDialog()
$region = $snip.Region
if ($region.Width -lt 2 -or $region.Height -lt 2) {{ exit 2 }}
$bmp = New-Object System.Drawing.Bitmap($region.Width, $region.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($region.Location, [System.Drawing.Point]::Empty, $region.Size)
$bmp.Save('{escaped}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"#
    )
}

/// Windows: the overlay lives in a generated script executed by PowerShell.
fn capture_windows(out_path: &Path) -> CaptureOutcome {
    let script = windows_script(out_path);
    // -EncodedCommand keeps the quoting intact through cmd/PowerShell layers.
    let encoded = encode_utf16le_base64(&script);

    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", &encoded]);
    apply_no_window(&mut cmd);

    match cmd.status() {
        Ok(_) if out_path.is_file() => CaptureOutcome::ok(out_path.to_path_buf(), "powershell"),
        // exit 2 = the user dismissed the overlay with Esc.
        Ok(status) if status.code() == Some(2) => CaptureOutcome::cancelled("powershell"),
        Ok(status) if status.success() => CaptureOutcome {
            path: None,
            cancelled: false,
            tool: "powershell".into(),
            error: Some("the capture overlay wrote no image".into()),
        },
        Ok(_) => CaptureOutcome::cancelled("powershell"),
        Err(e) => CaptureOutcome {
            path: None,
            cancelled: false,
            tool: "powershell".into(),
            error: Some(format!("could not run powershell: {e}. {}", missing_tool_help("windows", false))),
        },
    }
}

/// PowerShell wants UTF-16LE base64 for -EncodedCommand.
fn encode_utf16le_base64(script: &str) -> String {
    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect();
    base64_encode(&utf16)
}

/// Dependency-free base64 (std has none, and a 40-line function beats a crate
/// for one call site).
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Delete a capture after the webview has attached it. Missing file = success.
pub fn discard(path: &str) -> bool {
    std::fs::remove_file(path).is_ok() || !Path::new(path).exists()
}

/// Sweep captures older than `max_age_ms` (a crashed session can leave a file
/// behind; they are transient by contract).
pub fn sweep_scratch(dir: &Path, max_age_ms: u128) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Ok(modified) = meta.modified() else { continue };
        let Ok(age) = modified.elapsed() else { continue };
        if (age.as_millis()) > max_age_ms && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_are_per_platform_and_ordered() {
        let mac = plan_for("macos", false);
        assert_eq!(mac.candidates[0].program, "/usr/sbin/screencapture");
        assert!(mac.candidates[0].args.contains(&"-i"), "interactive region mode");

        let win = plan_for("windows", false);
        assert!(win.candidates.is_empty(), "windows uses the overlay, not a CLI tool");

        let x11 = plan_for("linux", false);
        assert_eq!(x11.candidates[0].program, "grim");
        assert!(x11.candidates.iter().any(|c| c.program == "gnome-screenshot"));
        assert!(x11.candidates.iter().any(|c| c.program == "scrot"));

        let wl = plan_for("linux", true);
        assert!(wl.wayland);
        // X11-only tools are not attempted on a Wayland session.
        assert!(!wl.candidates.iter().any(|c| c.program == "scrot"));
    }

    #[test]
    fn missing_tool_help_names_the_fix_per_platform() {
        let wl = missing_tool_help("linux", true);
        assert!(wl.contains("grim"), "Wayland message names grim: {wl}");
        assert!(wl.contains("portal"), "and mentions the portal");
        assert!(missing_tool_help("linux", false).contains("scrot"));
        assert!(missing_tool_help("macos", false).contains("screencapture"));
        assert!(missing_tool_help("windows", false).contains("PowerShell"));
    }

    #[test]
    fn tool_availability_checks_the_filesystem() {
        // A path that cannot exist, and a binary that certainly does on Linux.
        assert!(!tool_available("definitely-not-a-real-tool-xyz"));
        assert!(!tool_available("/no/such/path/tool"));
        #[cfg(unix)]
        assert!(tool_available("/bin/sh") || tool_available("/usr/bin/env"));
    }

    #[test]
    fn output_paths_are_png_inside_the_scratch_dir() {
        let dir = Path::new("/tmp/xr-shots");
        let p = output_path(dir, 1_700_000_000_000);
        assert_eq!(p.parent(), Some(dir));
        assert!(p.display().to_string().ends_with(".png"));
        assert!(p.display().to_string().contains("1700000000000"));
    }

    #[test]
    fn scratch_dir_is_transient_not_under_xr_home() {
        let scratch = scratch_dir();
        assert!(scratch.display().to_string().contains("xr-shots"));
        assert!(
            !scratch.display().to_string().contains(".xr/"),
            "captures must not quietly persist in the data directory"
        );
    }

    #[test]
    fn windows_script_is_utf16_base64_and_carries_the_path() {
        let encoded = encode_utf16le_base64("hi");
        // "hi" in UTF-16LE is 68 00 69 00 → base64 "aABpAA==".
        assert_eq!(encoded, "aABpAA==");

        let script = windows_script(Path::new("C:\\Users\\a\\shot.png"));
        assert!(script.contains("XRSnip"));
        assert!(script.contains("C:\\Users\\a\\shot.png"));
        // Single quotes in a payload are escaped for PowerShell.
        let quoted = windows_script(Path::new("C:\\it's here\\s.png"));
        assert!(quoted.contains("''s"), "quote escaping: {quoted}");
        assert!(script.contains("Keys.Escape"), "Esc cancels");
        assert!(script.contains("ImageFormat]::Png"));
    }

    #[test]
    fn discard_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("xr-p27-discard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("shot.png");
        std::fs::write(&file, b"png").unwrap();
        assert!(discard(&file.display().to_string()));
        assert!(!file.exists());
        assert!(discard(&file.display().to_string()), "already gone is a success");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

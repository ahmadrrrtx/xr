# Registry InstallLocation is a path, sometimes wrapped in literal quotes by
# the Tauri NSIS template. Reject malformed quoting; never evaluate it as code.
function Resolve-InstallerLocation([string]$location, [string]$uninstaller) {
  $value = $location.Trim()
  if ($value.StartsWith('"') -or $value.EndsWith('"')) {
    if ($value.Length -lt 2 -or !$value.StartsWith('"') -or !$value.EndsWith('"')) {
      throw 'malformed quoted InstallLocation'
    }
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ($value.Contains('"')) { throw 'malformed quoted InstallLocation' }
  if (!$value -and $uninstaller) { $value = Split-Path -Parent $uninstaller }
  return $value
}

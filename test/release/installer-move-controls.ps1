# NEW-3 controls for install.ps1's Move-XrItemWithRetry. Dot-sourcing install.ps1
# only defines its functions. Two controls run on every PowerShell host; the four
# that need real Windows file sharing run only on Windows.
#
# Why the SOURCE is held: with -Force, PowerShell reports the first MoveTo error
# even when its fallback (delete the destination, move again) fails, so a held
# destination surfaces as "already exists" (183). The CI journey's "being used by
# another process" (32) therefore came from the just-run .partial binary.
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'install.ps1')
$onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$dir = Join-Path ([IO.Path]::GetTempPath()) ('xr move fixture ' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$src = Join-Path $dir '.partial-xr.exe'
$dst = Join-Path $dir 'xr.exe'
$pass = 0
try {
  [IO.File]::WriteAllText($src, 'N+1'); [IO.File]::WriteAllText($dst, 'N')
  Move-XrItemWithRetry -Path $src -Destination $dst
  if ([IO.File]::ReadAllText($dst) -ne 'N+1' -or (Test-Path -LiteralPath $src)) { throw 'an unheld binary was not replaced' }
  $pass++

  $clock = [Diagnostics.Stopwatch]::StartNew(); $failed = $false
  try { Move-XrItemWithRetry -Path (Join-Path $dir 'missing.exe') -Destination $dst } catch { $failed = $true }
  if (-not $failed -or $clock.ElapsedMilliseconds -gt 2000) { throw "a missing source must fail at once (failed=$failed, $($clock.ElapsedMilliseconds) ms)" }
  $pass++

  if ($onWindows) {
    Add-Type -TypeDefinition @'
public static class XrHeldFile {
  // Opens the file the way a scanner or a still-exiting process can: readers allowed, delete and rename refused.
  public static System.Threading.Tasks.Task Hold(string path, int ms) {
    var stream = new System.IO.FileStream(path, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.Read);
    return System.Threading.Tasks.Task.Delay(ms).ContinueWith(_ => stream.Dispose());
  }
}
'@
    # Negative control: with the new binary held, a plain Move-Item (the code before the fix) fails exactly as the
    # CI journey did, with an IOException carrying ERROR_SHARING_VIOLATION (32).
    [IO.File]::WriteAllText($src, 'N+2')
    $held = [XrHeldFile]::Hold($src, 1500); $code = 0
    try { Move-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop }
    catch { if ($_.Exception -is [IO.IOException]) { $code = $_.Exception.HResult -band 0xFFFF } }
    $null = $held.Wait(10000)
    if ($code -ne 32) { throw "negative control: a plain Move-Item of a held binary did not fail with a sharing violation (code $code)" }
    $pass++

    # The retry waits the hold out, whether or not an installed binary is still in place.
    $held = [XrHeldFile]::Hold($src, 1500); $clock.Restart()
    Move-XrItemWithRetry -Path $src -Destination $dst -Attempts 50 -DelayMs 100
    $null = $held.Wait(10000)
    if ([IO.File]::ReadAllText($dst) -ne 'N+2' -or (Test-Path -LiteralPath $src) -or $clock.ElapsedMilliseconds -lt 1000) { throw "held binary: not moved once the lock ended ($($clock.ElapsedMilliseconds) ms)" }
    $pass++

    [IO.File]::WriteAllText($src, 'N+3')
    $held = [XrHeldFile]::Hold($src, 1500); $clock.Restart()
    Move-XrItemWithRetry -Path $src -Destination $dst -Attempts 50 -DelayMs 100
    $null = $held.Wait(10000)
    if ([IO.File]::ReadAllText($dst) -ne 'N+3' -or (Test-Path -LiteralPath $src) -or $clock.ElapsedMilliseconds -lt 1000) { throw "held binary over an installed one: not replaced once the lock ended ($($clock.ElapsedMilliseconds) ms)" }
    $pass++

    # A hold longer than the budget ends in the original sharing violation, and the new binary is kept.
    [IO.File]::WriteAllText($src, 'N+4')
    $held = [XrHeldFile]::Hold($src, 3000); $clock.Restart(); $err = $null
    try { Move-XrItemWithRetry -Path $src -Destination $dst -Attempts 3 -DelayMs 100 } catch { $err = $_.Exception }
    $elapsed = $clock.ElapsedMilliseconds
    $null = $held.Wait(10000)
    if (-not ($err -is [IO.IOException]) -or (($err.HResult -band 0xFFFF) -ne 32) -or $elapsed -lt 200 -or $elapsed -gt 2500 -or [IO.File]::ReadAllText($src) -ne 'N+4') {
      throw "a hold longer than the budget must end in the original sharing violation (error: $err; $elapsed ms)"
    }
    $pass++
  }
  Write-Host "PowerShell install move controls: $pass PASS"
} finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }

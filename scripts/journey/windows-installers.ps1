# Preview 1 section 13 — run ONLY on an isolated GitHub-hosted Windows runner.
# The calling workflow downloads the exact-head-SHA desktop artifact first.
# No token or HTTP authorization header is printed or written to the evidence.
param(
  [Parameter(Mandatory=$true)][string]$Bundles,
  [Parameter(Mandatory=$true)][string]$EvidenceDir
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-install-path.ps1')
if ($env:RUNNER_OS -ne 'Windows' -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Windows GitHub Actions runner required; refusing to modify this machine' }
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
$EvidenceDir = (Resolve-Path -LiteralPath $EvidenceDir).Path
$expectedVersion = (Get-Content -Raw -LiteralPath "release.manifest.json" | ConvertFrom-Json).identity.version
if (!$expectedVersion) { throw "release manifest has no version" }
$events = [System.Collections.Generic.List[object]]::new()
function Record([string]$kind, [string]$phase, [string]$state, [string]$detail) {
  $events.Add([ordered]@{ installer=$kind; phase=$phase; state=$state; detail=$detail })
  Write-Host "[$kind] $phase $state - $detail"
  $events | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $EvidenceDir 'windows-installer-events.json')
}
function Assert([bool]$condition, [string]$message) { if (-not $condition) { throw $message } }
function XrRegistrations {
  @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'XR' })
}
function WaitUntil([scriptblock]$predicate, [int]$seconds) {
  $end = (Get-Date).AddSeconds($seconds)
  do { if (& $predicate) { return $true }; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $end)
  return $false
}
function Exec([string]$exe, [string[]]$arguments) {
  $p = Start-Process -FilePath $exe -ArgumentList $arguments -Wait -PassThru
  Assert ($p.ExitCode -eq 0) "process failed with exit $($p.ExitCode): $(Split-Path $exe -Leaf)"
}
function Status([string]$url, [string]$token) {
  try {
    $headers = @{}
    if ($token) { $headers['Authorization'] = "Bearer $token" }
    $res = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers -TimeoutSec 5 -SkipHttpErrorCheck
    return $res
  } catch { return $null }
}
function MsiProductCode([string]$path) {
  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $installer.OpenDatabase($path, 0)
  $view = $database.OpenView('SELECT `Value` FROM `Property` WHERE `Property` = ''ProductCode''')
  [void]$view.Execute(); $row = $view.Fetch()
  Assert ($null -ne $row) 'MSI ProductCode missing'
  $id = $row.StringData(1)
  Assert ($id -match '^\{[0-9A-Fa-f-]{36}\}$') 'MSI ProductCode malformed'
  return $id
}
function WaitForAppEngine([System.Diagnostics.Process]$app, [string]$desktopHome, [string]$enginePath) {
  $end = (Get-Date).AddSeconds(90)
  do {
    $app.Refresh()
    if ($app.HasExited) {
      # Exit code and selected OS fault metadata are safe to publish; never
      # upload unfiltered stdout, stderr, environment, token files or logs.
      $exitCode = ('0x{0:X8}' -f ([uint32]([int64]$app.ExitCode -band 0xFFFFFFFFL)))
      Start-Sleep -Seconds 2 # allow Windows Application Error to be recorded
      $faults = @(Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000; StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue | Where-Object { $_.Message -match '(?i)xr-desktop\.exe' } | Select-Object -First 1)
      $fault = 'no matching application-error event'
      if ($faults.Count) {
        $message = [string]$faults[0].Message
        $exception = [regex]::Match($message, '(?i)exception code:\s*(0x[0-9a-f]+)')
        $module = [regex]::Match($message, '(?i)faulting module name:\s*([a-z0-9_.-]+)')
        $fault = "application-error event present; exception=$($exception.Groups[1].Value); module=$($module.Groups[1].Value)"
      }
      throw "installed desktop process exited before engine was ready; exit=$exitCode; $fault"
    }
    $appId = $app.Id
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $appId" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $enginePath })
    foreach ($child in $children) {
      $listeners = @(Get-NetTCPConnection -OwningProcess $child.ProcessId -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' })
      $tokenFile = Join-Path $desktopHome 'daemon/token'
      if (!(Test-Path -LiteralPath $tokenFile)) { continue }
      $token = (Get-Content -Raw -LiteralPath $tokenFile).Trim()
      if ($token -notmatch '^[0-9a-f]{48}$') { continue }
      foreach ($listener in $listeners) {
        $base = "http://127.0.0.1:$($listener.LocalPort)/api/v1"
        $health = Status "$base/health" ''
        if (!$health -or $health.StatusCode -ne 200) { continue }
        $anonymous = Status "$base/meta/version" ''
        $badToken = '0' * 48
        if ($badToken -eq $token) { $badToken = '1' * 48 }
        $wrong = Status "$base/meta/version" $badToken
        $good = Status "$base/meta/version" $token
        Assert ($anonymous -and $anonymous.StatusCode -eq 401) 'protected endpoint did not reject anonymous request'
        Assert ($wrong -and $wrong.StatusCode -eq 401) 'protected endpoint did not reject invalid bearer'
        Assert ($good -and $good.StatusCode -eq 200) 'protected endpoint did not accept generated bearer'
        $version = ($good.Content | ConvertFrom-Json).version
        Assert ($version -eq $expectedVersion) 'installed sidecar returned an unexpected version'
        return [int]$child.ProcessId
      }
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $end)
  throw 'installed app-owned sidecar did not become healthy and authenticated within 90 seconds'
}
function Screenshot([string]$kind) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    Assert ($bounds.Width -gt 0 -and $bounds.Height -gt 0) 'no interactive desktop'
    $image = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    try { $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $image.Save((Join-Path $EvidenceDir "$kind-screen.png")) }
    finally { $graphics.Dispose(); $image.Dispose() }
    Record $kind 'screenshot' 'PASS' 'runner screen captured; not a human visual inspection'
  } catch { Record $kind 'screenshot' 'NOT RUN' 'runner screen capture unavailable' }
}

try {
  $msis = @(Get-ChildItem -LiteralPath $Bundles -Recurse -File -Filter '*.msi')
  $nsis = @(Get-ChildItem -LiteralPath $Bundles -Recurse -File | Where-Object { $_.Name -match '-setup\.exe$' })
  Assert ($msis.Count -eq 1 -and $nsis.Count -eq 1) 'exactly one MSI and one NSIS installer are required'
  Assert (@(XrRegistrations).Count -eq 0) 'pre-existing XR registration: refusing destructive install on this runner'
  foreach ($item in @(@{ kind='NSIS'; file=$nsis[0] }, @{ kind='MSI'; file=$msis[0] })) {
    $kind = $item.kind; $file = $item.file.FullName; $phase = 'package'; $app = $null; $childId = $null; $uninstaller = $null; $productCode = $null
    $desktopHome = Join-Path $env:RUNNER_TEMP ("xr-install-test-" + $kind.ToLower())
    New-Item -ItemType Directory -Force -Path $desktopHome | Out-Null
    $env:XR_DESKTOP_HOME = $desktopHome
    $sentinel = Join-Path $desktopHome 'uninstall-preservation-sentinel.txt'
    [IO.File]::WriteAllText($sentinel, 'XR test data must survive uninstall')
    try {
      Record $kind $phase 'PASS' ("file=$($item.file.Name); sha256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower())")
      $phase = 'install'
      if ($kind -eq 'NSIS') { Exec $file @('/S') }
      else { $productCode = MsiProductCode $file; Exec "$env:SystemRoot\System32\msiexec.exe" @('/i', "`"$file`"", '/qn', '/norestart') }
      Assert (WaitUntil { @(XrRegistrations).Count -eq 1 } 60) 'expected exactly one XR uninstall registration after install'
      $entry = @(XrRegistrations)[0]
      if ($kind -eq 'MSI') { Assert ($entry.PSChildName -ieq $productCode) ("MSI registration ProductCode mismatch: registry=$($entry.PSChildName); package=$productCode") }
      else {
        $m = [regex]::Match([string]$entry.UninstallString, '^\s*(?:"([^"]+\.exe)"|(.+?\.exe))', 'IgnoreCase')
        Assert $m.Success 'NSIS uninstall path missing from registration'
        $uninstaller = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
        Assert (Test-Path -LiteralPath $uninstaller -PathType Leaf) 'registered NSIS uninstaller does not exist'
      }
      $dir = Resolve-InstallerLocation ([string]$entry.InstallLocation) $uninstaller
      Assert ($dir -and (Test-Path -LiteralPath $dir -PathType Container)) 'installer did not provide a valid install directory'
      $engines = @(Get-ChildItem -LiteralPath $dir -File -Filter 'xr-engine*.exe')
      $apps = @(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -match '^xr-desktop\.exe$' })
      Assert ($engines.Count -eq 1 -and $apps.Count -eq 1) 'installed desktop executable or unique sidecar missing'
      $enginePath = $engines[0].FullName; $appPath = $apps[0].FullName
      Record $kind $phase 'PASS' 'registered installer, desktop executable and sidecar found'
      $phase = 'launch-auth'
      $app = Start-Process -FilePath $appPath -PassThru
      $childId = WaitForAppEngine $app $desktopHome $enginePath
      Record $kind $phase 'PASS' 'installed app-owned sidecar: health 200; anonymous and invalid bearer 401; valid bearer 200; expected version'
      Screenshot $kind
      $phase = 'shutdown'
      Stop-Process -Id $app.Id -Force -ErrorAction Stop
      Assert (WaitUntil { -not (Get-Process -Id $childId -ErrorAction SilentlyContinue) } 20) 'app-owned sidecar survived app termination'
      Record $kind $phase 'PASS' 'app and its sidecar terminated'
      $app = $null
      $phase = 'uninstall'
      if ($kind -eq 'NSIS') { Exec $uninstaller @('/S') }
      else { Exec "$env:SystemRoot\System32\msiexec.exe" @('/x', $productCode, '/qn', '/norestart') }
      Assert (WaitUntil { !(Test-Path -LiteralPath $appPath) -and !(Test-Path -LiteralPath $enginePath) -and @(XrRegistrations).Count -eq 0 } 90) 'installed binaries or registration remained after uninstall'
      Assert ((Test-Path -LiteralPath $sentinel) -and ([IO.File]::ReadAllText($sentinel) -eq 'XR test data must survive uninstall')) 'desktop home sentinel was removed or modified'
      Record $kind $phase 'PASS' 'binaries and registration removed; isolated desktop-home sentinel retained'
    } catch {
      Record $kind $phase 'FAIL' $_.Exception.Message
      throw
    } finally {
      if ($app -and (Get-Process -Id $app.Id -ErrorAction SilentlyContinue)) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    }
  }
  Record 'ALL' 'result' 'PASS' 'both installers completed all required assertions'
} catch {
  Record 'ALL' 'result' 'FAIL' $_.Exception.Message
  throw
} finally {
  Remove-Item Env:XR_DESKTOP_HOME -ErrorAction SilentlyContinue
}

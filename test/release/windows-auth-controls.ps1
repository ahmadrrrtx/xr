# Exercises the production orchestration with fakes. No native process, network
# socket, installer, or real Windows registry is touched by this test.
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'scripts/journey/windows-installers.ps1').Path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'installer PowerShell parse failed' }
foreach ($name in @('Assert', 'WaitForAppEngine')) {
  $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (!$function) { throw "missing function $name" }
  Invoke-Expression $function.Extent.Text
}
$expectedVersion = '1.2.0-preview.1'
$desktopHome = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path (Join-Path $desktopHome 'daemon') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $desktopHome 'daemon/token'), ('a' * 48))
function Get-Process { param($Id, $ErrorAction); return @{ Id = $Id } }
function Get-CimInstance { param($Filter, $ErrorAction); return @{ ExecutablePath = 'C:\test\xr-engine.exe'; ProcessId = 123 } }
function Get-NetTCPConnection { param($OwningProcess, $State, $ErrorAction); return @{ LocalAddress = '127.0.0.1'; LocalPort = 45678 } }
function Status {
  param($url, $token)
  if ($url.EndsWith('/health')) { return @{ StatusCode = 200 } }
  if (!$token) { return @{ StatusCode = $(if ($script:mode -eq 'anonymous-accepted') { 200 } else { 401 }) } }
  if ($token -eq ('0' * 48)) { return @{ StatusCode = $(if ($script:mode -eq 'wrong-accepted') { 200 } else { 401 }) } }
  return @{ StatusCode = $(if ($script:mode -eq 'good-rejected') { 401 } else { 200 }); Content = $(if ($script:mode -eq 'wrong-version') { '{"version":"wrong"}' } else { '{"version":"1.2.0-preview.1"}' }) }
}
try {
  $script:mode = 'good'
  if ((WaitForAppEngine 100 $desktopHome 'C:\test\xr-engine.exe') -ne 123) { throw 'valid token control failed' }
  foreach ($mode in @('anonymous-accepted','wrong-accepted','good-rejected','wrong-version')) {
    $script:mode = $mode
    $denied = $false
    try { WaitForAppEngine 100 $desktopHome 'C:\test\xr-engine.exe' | Out-Null } catch { $denied = $true }
    if (!$denied) { throw "invalid $mode control was falsely accepted" }
  }
  Write-Host 'PowerShell auth controls: 5 PASS (fake app/process/HTTP)'
} finally { Remove-Item -LiteralPath $desktopHome -Recurse -Force }

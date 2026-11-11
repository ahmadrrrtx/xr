$ErrorActionPreference = 'Stop'
. (Join-Path (Resolve-Path 'scripts/journey').Path 'windows-install-path.ps1')
$folder = Join-Path ([IO.Path]::GetTempPath()) ("xr path fixture " + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $folder -Force | Out-Null
try {
  $quoted = '"' + $folder + '"'
  if (Test-Path -LiteralPath $quoted -PathType Container) { throw 'negative control: quoted literal path unexpectedly exists' }
  if ((Resolve-InstallerLocation $quoted '') -ne $folder) { throw 'balanced quote normalization failed' }
  if (!(Test-Path -LiteralPath (Resolve-InstallerLocation $quoted '') -PathType Container)) { throw 'normalized directory not found' }
  if ((Resolve-InstallerLocation $folder '') -ne $folder) { throw 'unquoted path changed' }
  if ((Resolve-InstallerLocation '' (Join-Path $folder 'uninstall.exe')) -ne $folder) { throw 'missing location fallback failed' }
  foreach ($invalid in @('"unterminated', 'unopened"', '"inner"quote"', '"x" /S')) {
    $threw = $false
    try { Resolve-InstallerLocation $invalid '' | Out-Null } catch { $threw = $true }
    if (!$threw) { throw "malformed location accepted: $invalid" }
  }
  Write-Host 'PowerShell install-location controls: 8 PASS'
} finally { Remove-Item -LiteralPath $folder -Recurse -Force }

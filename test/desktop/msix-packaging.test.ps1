# Executable Linux regression for the PowerShell packaging path. Fake SDK tools
# are real native processes: the Windows bundle job still runs real MakeAppx and
# SignTool. No test output here is an installable MSIX or release evidence.
$ErrorActionPreference = 'Stop'
if (-not $IsLinux) { throw 'This SDK-stub regression is intended for Linux.' }

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$script = Join-Path $root 'packaging/windows/msix/build-msix.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('xr-msix-test-' + [guid]::NewGuid().ToString('N'))
$bin = Join-Path $fixture 'bin'
$app = Join-Path $fixture 'app'
$assets = Join-Path $fixture 'assets'
$out = Join-Path $fixture 'out'
$cert = Join-Path $fixture 'test.pfx'
$manifest = Join-Path $root 'packaging/windows/msix/AppxManifest.xml'
$oldPath = $env:PATH

function Assert([bool]$ok, [string]$message) {
  if (-not $ok) { throw "Assertion failed: $message" }
}
function Expect-Failure([scriptblock]$action, [string]$message) {
  $caught = $false
  try { & $action } catch {
    $caught = $true
    if (-not $_.Exception.Message.Contains($message)) { throw }
  }
  Assert $caught "expected failure containing '$message'"
}
function Package([string]$version, [switch]$sign) {
  $args = @{
    AppDir = $app; BinariesDir = $app; AssetsDir = $assets; OutDir = $out
    Manifest = $manifest; Version = $version
  }
  if ($sign) {
    $args.Sign = $true
    $args.CertPath = $cert
    $args.CertPassword = ConvertTo-SecureString 'fixture' -AsPlainText -Force
  }
  & $script @args
}
function Assert-StageRemoved {
  $stage = [IO.File]::ReadAllText($env:XR_TEST_STAGE).Trim()
  Assert (-not (Test-Path -LiteralPath $stage)) 'temporary staging directory was not removed'
}

try {
  New-Item -ItemType Directory -Force -Path $bin, $app, $assets, $out | Out-Null
  Set-Content (Join-Path $app 'xr-desktop.exe') 'shell'
  Set-Content (Join-Path $app 'xr-engine-fixture.exe') 'engine'
  Set-Content (Join-Path $assets 'fixture.png') 'image'
  Set-Content $cert 'test-only'
  $env:XR_TEST_CALLS = Join-Path $fixture 'calls'
  $env:XR_TEST_STAGE = Join-Path $fixture 'stage'
  $env:XR_TEST_MANIFEST = Join-Path $fixture 'captured.xml'
  $make = Join-Path $bin 'MakeAppx.exe'
  $sign = Join-Path $bin 'signtool.exe'
  [IO.File]::WriteAllText($make, @'
#!/bin/sh
stage= output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    /d) stage=$2; shift 2 ;;
    /p) output=$2; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s' "$stage" > "$XR_TEST_STAGE"
printf 'pack\n' >> "$XR_TEST_CALLS"
cp "$stage/AppxManifest.xml" "$XR_TEST_MANIFEST"
[ "${XR_TEST_PACK_FAIL:-0}" = 0 ] || exit "$XR_TEST_PACK_FAIL"
[ "${XR_TEST_NO_OUTPUT:-0}" = 0 ] || exit 0
printf 'fixture package' > "$output"
'@ + "`n")
  [IO.File]::WriteAllText($sign, @'
#!/bin/sh
printf 'sign\n' >> "$XR_TEST_CALLS"
exit "${XR_TEST_SIGN_FAIL:-0}"
'@ + "`n")
  & chmod +x $make $sign
  if ($LASTEXITCODE -ne 0) { throw 'Could not make SDK stubs executable' }
  $env:PATH = "$bin$([IO.Path]::PathSeparator)$oldPath"

  foreach ($case in @(
    @('1.1.1-rc.1', '1.1.1.0'), @('1.1.1', '1.1.1.0'),
    @('v1.2.3+meta', '1.2.3.0'), @('1.2.65535', '1.2.65535.0'),
    @('1.2.3.4', '1.2.3.4')
  )) {
    Package $case[0]
    $package = Join-Path $out "XR_$($case[1])_x64.msix"
    Assert (Test-Path -LiteralPath $package) "package for $($case[0]) is missing"
    [xml]$xml = Get-Content -LiteralPath $env:XR_TEST_MANIFEST -Raw
    $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable)
    $ns.AddNamespace('appx', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
    $id = $xml.SelectSingleNode('/appx:Package/appx:Identity', $ns)
    $target = $xml.SelectSingleNode('/appx:Package/appx:Dependencies/appx:TargetDeviceFamily', $ns)
    Assert ($id.GetAttribute('Version') -eq $case[1]) 'wrong package identity version'
    Assert ($target.GetAttribute('MinVersion') -eq '10.0.19041.0') 'minimum Windows version changed'
    Assert ($target.GetAttribute('MaxVersionTested') -eq '10.0.22621.0') 'tested Windows version changed'
    Assert-StageRemoved
  }
  foreach ($version in @('65536.0.0', '1.2.65536-rc.1', '1.2.03', '1.2.3-rc..1', '1.2.3.4.5')) {
    Expect-Failure { Package $version } 'MSIX'
  }

  $current = Join-Path $out 'XR_1.1.1.0_x64.msix'
  Clear-Content $env:XR_TEST_CALLS
  $env:XR_TEST_PACK_FAIL = '7'
  Expect-Failure { Package '1.1.1-rc.1' -sign } 'MakeAppx failed with exit code 7'
  Assert (-not (Test-Path -LiteralPath $current)) 'failed pack left an old package'
  Assert (-not ((Get-Content $env:XR_TEST_CALLS) -contains 'sign')) 'signing ran after a failed pack'
  Assert-StageRemoved
  $env:XR_TEST_PACK_FAIL = '0'

  $env:XR_TEST_NO_OUTPUT = '1'
  Expect-Failure { Package '1.1.1-rc.1' } 'produced no package'
  Assert-StageRemoved
  $env:XR_TEST_NO_OUTPUT = '0'

  $env:XR_TEST_SIGN_FAIL = '9'
  Expect-Failure { Package '1.1.1-rc.1' -sign } 'SignTool failed with exit code 9'
  Assert (-not (Test-Path -LiteralPath $current)) 'failed signing left an unsigned package'
  Assert-StageRemoved
  $env:XR_TEST_SIGN_FAIL = '0'
  Package '1.1.1-rc.1' -sign
  Assert (Test-Path -LiteralPath $current) 'signed-path package missing'
  Assert-StageRemoved
  Write-Host 'MSIX PowerShell regression: PASS (fake SDK processes; not native packaging evidence)'
} finally {
  $env:PATH = $oldPath
  Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# GENERATED from release.manifest.json — regenerate: bun run channel:render
# Built by scripts/package-linux.ts (rpmbuild on the release runner); SOURCE0 is
# the canonical xr-linux-x64 binary from SHA256SUMS (never a rebuilt artifact).
Name:           xr
Version:        7.1.0
Release:        1%{?dist}
Summary:        XR — local-first, provider-neutral AI agent runtime

License:        MIT
URL:            https://xr-gules.vercel.app
Source0:        xr-linux-x64
Requires:       coreutils
AutoReqProv:    no

%description
XR — a local-first, provider-neutral AI agent runtime. BYOK, spend-capped, tamper-evident audit, plugin/MCP extensibility.

%install
mkdir -p %{buildroot}/usr/bin %{buildroot}/usr/share/licenses/xr
install -m 0755 %{SOURCE0} %{buildroot}/usr/bin/xr
install -m 0644 %{SOURCE1} %{buildroot}/usr/share/licenses/xr/LICENSE

%files
/usr/bin/xr
%license /usr/share/licenses/xr/LICENSE

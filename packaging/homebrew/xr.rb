# GENERATED from release.manifest.json — do not edit by hand.
# Regenerate: bun run channel:render (source of truth: manifest.distribution)
# Phase 9 · T3. Hash tokens are pinned with real digests from SHA256SUMS at
# release time; a formula with __SHA256_…__ tokens is never published.
class Xr < Formula
  desc "XR — a local-first, provider-neutral AI agent runtime. BYOK, spend-capped, tamper-evident audit."
  homepage "https://xr-gules.vercel.app"
  version "7.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/ahmadrrrtx/xr/releases/download/v7.1.0/xr-darwin-arm64"
      sha256 "__SHA256_XR_DARWIN_ARM64__"
    end
    on_intel do
      url "https://github.com/ahmadrrrtx/xr/releases/download/v7.1.0/xr-darwin-x64"
      sha256 "__SHA256_XR_DARWIN_X64__"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/ahmadrrrtx/xr/releases/download/v7.1.0/xr-linux-arm64"
      sha256 "__SHA256_XR_LINUX_ARM64__"
    end
    on_intel do
      url "https://github.com/ahmadrrrtx/xr/releases/download/v7.1.0/xr-linux-x64"
      sha256 "__SHA256_XR_LINUX_X64__"
    end
  end

  def install
    bin.install Dir["xr-*"].first => "xr"
  end

  def caveats
    <<~EOS
      XR is a Public Beta. Report false claims or bugs:
        https://github.com/ahmadrrrtx/xr/issues
      Verify this release: https://github.com/ahmadrrrtx/xr/blob/main/docs/release/VERIFYING_RELEASES.md
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/xr --version")
  end
end

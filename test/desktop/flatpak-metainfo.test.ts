/*
 * Flatpak + AppStream metadata guards (Phase 27).
 *
 * These exist because CI caught two real defects that no test covered:
 *
 *   · `Categories=Development;AI;Utility;` — `AI` is not a registered
 *     freedesktop category, so `desktop-file-validate` fails and desktop menus
 *     ignore it. (The fix puts "AI" in Keywords, where it is actually
 *     searchable.)
 *   · a `--` inside an XML comment, which is illegal in XML and makes
 *     `appstreamcli validate` fail to parse the file at all.
 *
 * Both are the kind of thing that only shows up when a validator runs, so the
 * validator is not a substitute for this file — this file is what makes the
 * *file* fail in `bun test` instead of in a CI job twenty minutes later.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");

const DESKTOP = "packaging/flatpak/ai.rrrtx.xr-desktop.desktop";
const METAINFO = "packaging/flatpak/ai.rrrtx.xr-desktop.metainfo.xml";
const MANIFEST = "packaging/flatpak/ai.rrrtx.xr-desktop.yml";
const APP_ID = "ai.rrrtx.xr-desktop";

/** The freedesktop registered main + additional categories XR could claim. */
const REGISTERED_CATEGORIES = new Set([
  "Development",
  "Utility",
  "AI",
  "AudioVideo",
  "Graphics",
  "Network",
  "Office",
  "Science",
  "System",
  "Settings",
]);

describe("Phase 27 · flatpak desktop entry", () => {
  const text = read(DESKTOP);
  const entries = Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()])
  );

  test("every category is registered — no AI, which validate rejects", () => {
    const categories = (entries.Categories ?? "").split(";").filter(Boolean);
    expect(categories.length).toBeGreaterThan(0);
    // The precise bug: `AI` is a real word people want and not a real category.
    expect(categories).not.toContain("AI");
    for (const category of categories) expect(REGISTERED_CATEGORIES).toContain(category);
    expect(categories).toContain("Development");
  });

  test("the fields a launcher needs are present and internally consistent", () => {
    expect(entries.Type).toBe("Application");
    expect(entries.Name).toBe("XR");
    expect(entries.Icon).toBe(APP_ID);
    expect(entries.Exec?.startsWith("xr-desktop ")).toBe(true);
    expect(entries.Terminal).toBe("false");
    // Wire the window to the entry, or the taskbar shows "unknown".
    expect(entries.StartupWMClass).toBe("xr-desktop");
    // xr:// deep links — the reason bundle.fileAssociations exists in tauri.conf.json.
    expect(entries.MimeType).toBe("x-scheme-handler/xr;");
    expect(entries.Keywords?.split(";")).toContain("AI");
  });

  test("the file is LF-only (desktop-file-validate rejects a BOM, launchers dislike CRLF)", () => {
    expect(text).not.toContain("\r");
    expect(text.startsWith("[Desktop Entry]")).toBe(true);
  });
});

describe("Phase 27 · AppStream metainfo", () => {
  const text = read(METAINFO);

  test("no '--' inside any XML comment (XML forbids it, appstreamcli fails to parse)", () => {
    for (const comment of text.match(/<!--[\s\S]*?-->/g) ?? []) {
      expect(comment.slice(4, -3)).not.toContain("--");
    }
  });

  test("identity matches the desktop entry, the manifest and the launcher", () => {
    expect(text).toContain(`<id>${APP_ID}</id>`);
    expect(text).toContain(`<launchable type="desktop-id">${APP_ID}.desktop</launchable>`);
    expect(text).toContain(`<component type="desktop-application">`);
    expect(text).toContain("<metadata_license>CC0-1.0</metadata_license>");
    expect(text).toContain("<project_license>MIT</project_license>");
  });

  test("the deprecated developer_name tag is gone (modern <developer> only)", () => {
    expect(text).not.toContain("<developer_name>");
    expect(text).toContain('<developer id="ai.rrrtx">');
  });

  test("screenshots are https and captioned — Flathub requires at least one", () => {
    const images = [...text.matchAll(/<image type="source">([^<]+)<\/image>/g)].map((m) => m[1]);
    expect(images.length).toBeGreaterThanOrEqual(1);
    for (const url of images) expect(url.startsWith("https://")).toBe(true);
    const captions = [...text.matchAll(/<caption>([^<]+)<\/caption>/g)].map((m) => m[1]);
    expect(captions.length).toBe(images.length);
    // They point at committed renders, not at release assets that may not exist.
    for (const url of images) expect(url).toContain("raw.githubusercontent.com");
  });

  test("releases and categories are present and category values are registered", () => {
    expect(text).toMatch(/<releases>[\s\S]*<release version="\d+\.\d+\.\d+"/);
    const categories = [...text.matchAll(/<category>([^<]+)<\/category>/g)].map((m) => m[1]);
    expect(categories).toContain("Development");
    for (const category of categories) expect(REGISTERED_CATEGORIES).toContain(category);
  });
});

describe("Phase 27 · flatpak manifest", () => {
  const text = read(MANIFEST);

  test("runtime is the GNOME platform — the freedesktop runtime has no webkit2gtk", () => {
    // This is not cosmetic: a Tauri app built against the fdo runtime fails to
    // build (no libwebkit2gtk-4.1 headers) and ships a blank window if forced.
    expect(text).toContain("runtime: org.gnome.Platform");
    expect(text).toContain("sdk: org.gnome.Sdk");
    expect(text).not.toContain("runtime: org.freedesktop.Platform");
    expect(text).not.toMatch(/^\s*- org\.freedesktop\.Sdk\.Extension\.rust-stable/m);
    expect(text).toContain("org.freedesktop.Sdk.Extension.node22");
  });

  test("permissions stay read: home yes, host never", () => {
    expect(text).toContain("- --filesystem=home");
    expect(text).not.toContain("- --filesystem=host");
    expect(text).toContain("- --talk-name=org.kde.StatusNotifierWatcher");
    // WebKit renders through GL: without --device=dri the window comes up blank.
    expect(text).toContain("- --device=dri");
  });

  test("the bun pin matches the repo's canonical version and is checksummed", () => {
    const pinned = read(".bun-version").trim();
    expect(text).toContain(`bun-v${pinned}/bun-linux-x64.zip`);
    expect(text).toContain(`bun-v${pinned}/bun-linux-aarch64.zip`);
    for (const match of text.matchAll(/sha256: ([0-9a-f]+)/g)) expect(match[1]).toHaveLength(64);
    expect(text).not.toContain("sha256: PLACEHOLDER");
  });

  test("Rust is pinned to the CI toolchain with checksums for both architectures", () => {
    const workflow = read(".github/workflows/desktop-app.yml");
    expect(workflow).toContain("toolchain: 1.99.1");
    expect(text).toContain("rust-1.99.1-x86_64-unknown-linux-gnu.tar.xz");
    expect(text).toContain("231fcae47ee950621374725b5fc3b5441d2fbda2955ac45dd7dc816d8876cfe7");
    expect(text).toContain("rust-1.99.1-aarch64-unknown-linux-gnu.tar.xz");
    expect(text).toContain("a48fb1e853be56ce9b8e2751f5464dbd5e16440cd81e237920f3a5e7e806333e");
    expect(text).toContain("prepend-path: /run/build/xr-desktop/.flatpak-tools/rust/bin");
    expect(text).toContain("--disable-ldconfig");
    expect(text).not.toMatch(/build-args:[^\n]*--share=network/);
  });

  test("the manifest never reintroduces npm ci (there is no package-lock.json)", () => {
    // Comments are stripped first: the file *explains* why `npm ci` cannot work
    // here, and that sentence must not be mistaken for the command itself.
    const commands = text
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(commands).not.toMatch(/npm ci/);
    expect(commands).toContain("--frozen-lockfile");
  });

  test("build dependencies are staged and consumed offline without build-network permission", () => {
    const workflow = read(".github/workflows/desktop-app.yml");
    const prepare = read("scripts/prepare-flatpak-sources.sh");
    const module = text.split("modules:")[1] ?? "";
    expect(module).toContain('CARGO_NET_OFFLINE: "true"');
    expect(module).toContain("--frozen-lockfile --ignore-scripts --offline");
    expect(module).toContain("cargo build --release --locked --offline");
    expect(module).not.toMatch(/build-args:[^\n]*--share=network/);
    expect(prepare).toContain("git archive HEAD");
    expect(prepare).toContain("cargo vendor --locked --versioned-dirs");
    expect(prepare).toContain("--frozen-lockfile --ignore-scripts");
    expect(workflow).toContain('scripts/prepare-flatpak-sources.sh "$RUNNER_TEMP/xr-flatpak-source"');
    const flatpakJob = workflow.split("  flatpak:")[1]?.split("\n  # ── Phase 5")[0] ?? "";
    expect(flatpakJob).not.toMatch(/^    continue-on-error:\s*true/m);
  });

  test("all installed Flatpak icons exist and have the advertised pixel dimensions", () => {
    const installs = [...text.matchAll(/install -Dm644 (desktop\/src-tauri\/icons\/\S+\.png) \/app\/share\/icons\/hicolor\/(\d+)x(\d+)\/apps\/[^\s]+\.png/g)];
    expect(installs.length).toBe(3);
    for (const [, source, width, height] of installs) {
      // PNG IHDR width and height are the big-endian words at bytes 16/20.
      const png = readFileSync(resolve(repoRoot, source));
      expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      expect(png.readUInt32BE(16)).toBe(Number(width));
      expect(png.readUInt32BE(20)).toBe(Number(height));
    }
  });

  test("the engine sidecar is installed next to the shell under /app/bin", () => {
    expect(text).toContain("/app/bin/xr-desktop");
    // The Rust side resolves `xr-engine-<target-triple>` beside its own exe, so
    // the install must preserve the triple-suffixed filename.
    expect(text).toMatch(/xr-engine-\*-unknown-linux-gnu/);
  });
});

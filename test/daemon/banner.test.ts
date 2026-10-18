/**
 * XR Phase 2.5 · P2-17 — ordinary daemon banner carries no bearer material.
 *
 * REPRODUCTION (baseline measured on a30013c): `xr serve` printed to the
 * terminal, in plain text:
 *
 *   Token: <48-hex>              ← 2.x local secret, shoulder-surfable
 *   Dashboard  /?token=…, Chat  /chat?token=…
 *
 * while the packaged-desktop engine got no portable signed-open at all.
 *
 * Two channels (one design):
 *   HUMAN  — `xr serve`: lines contain no `Token: <hex>` and no `?token=`;
 *            the recovery path is ONE honest line (XR_PRINT_TOKEN=1 or the
 *            dashboard paste sign-in).
 *   PRIVATE— desktop sidecar (`--parent-pid`) or explicit operator opt-in
 *            (`XR_PRINT_TOKEN=1`): the exact legacy `Token:` + `?token=` lines
 *            still print, byte-identical, because the Rust banner parser
 *            (engine_state.rs) is a real cross-language contract — its tests
 *            are untouched by design.
 *
 * Static contract tests against the banner source (no server boot needed).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const server = readFileSync(join(import.meta.dir, "..", "..", "src", "daemon", "server.ts"), "utf8");

describe("P2-17 two-channel banner design", () => {
  test("there is exactly one reveal condition and it is explicit: opts.revealToken or XR_PRINT_TOKEN=1", () => {
    expect(server).toContain('process.env.XR_PRINT_TOKEN === "1"');
    expect(server).toContain("opts.revealToken === true");
    expect(server).toMatch(/const reveal = /);
  });

  test("the PUBLIC side can never print a token (invariant over the shared template)", () => {
    // One banner template; every token-bearing expression must sit inside a `reveal ?` scope.
    const lines = server.slice(server.indexOf("if (!lanRuntime) console.log"), server.indexOf("stopTriggers")).split("\n");
    const tokenLines = lines.filter((ln) => ln.includes("${token}") || ln.includes("?token=") || ln.includes("(token)"));
    expect(tokenLines.length).toBeGreaterThanOrEqual(3); // Dashboard, Chat, Token rows
    for (const ln of tokenLines) expect(ln, ln).toContain("reveal ? ");
    expect(server).toContain("XR_PRINT_TOKEN=1 xr serve` on a private terminal"); // the honest one-line recovery
  });

  test("the PRIVATE side keeps the exact legacy lines the Rust banner parser consumes", () => {
    const banner = server.slice(server.indexOf("if (!lanRuntime) console.log"), server.indexOf("stopTriggers"));
    expect(banner).toContain('${xrDim("Token:")} ${xrDim(token)}');
    expect(banner).toContain("`${url}?token=${token}`");
    expect(banner).toContain("/chat?token=" + "${token}");
  });

  test("Desktop path opts in: the CLI marks the sidecar handshake (--parent-pid) as private", () => {
    const router = readFileSync(join(import.meta.dir, "..", "..", "src", "cli", "router.ts"), "utf8");
    expect(router).toContain("revealToken:");
    expect(router).toMatch(/revealToken: parentPid !== undefined/);
  });

  test("Rust banner-parser tests are untouched by this phase (cross-language contract)", () => {
    const state = readFileSync(join(import.meta.dir, "..", "..", "desktop", "src-tauri", "src", "engine_state.rs"), "utf8");
    expect(state).toContain("parse_banner_line");
    expect(state).toContain("Token: "); // strict 48-hex contract unchanged
  });

  test("no source surface (server/auth-page/openapi) still claims the token is printed unconditionally", () => {
    const openapi = readFileSync(join(import.meta.dir, "..", "..", "src", "daemon", "api", "openapi.ts"), "utf8");
    expect(openapi).not.toContain("printed once at `xr serve` startup");
    expect(openapi).toContain("XR_PRINT_TOKEN=1");
    const authPage = readFileSync(join(import.meta.dir, "..", "..", "src", "daemon", "auth-page.ts"), "utf8");
    expect(authPage).not.toContain("printed when the daemon");
    expect(authPage).toContain("XR_PRINT_TOKEN=1 xr serve");
  });
});

/**
 * Phase 31 · Bucket A — consolidated security regression suite.
 *
 * Each A-item gets at least one behavioural test here (not just a source
 * tripwire): headers are applied to real Responses, the dashboard's own
 * `escapeHtml`/`act` are extracted from the served script and executed, the
 * SSRF guard resolves through an injected resolver, the redactor runs over
 * a corpus, and the pairing backoff is driven with an injected clock. The
 * few static (source/file) assertions cover surfaces a unit test cannot
 * reach without a browser or a Next/Tauri build (A7, A9, A14, A15) — they
 * are tripwires, and the comments say so.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { applyCorsHeaders, applySecurityHeaders, API_CSP, DASHBOARD_CSP, SECURITY_TXT_URL } from "../../src/daemon/security-headers.ts";
import { PairingFailureBackoff, RateLimiter, STRICT_PAIRING_PATHS, makeHandler } from "../../src/daemon/server.ts";
import { DASHBOARD_SCRIPT } from "../../src/daemon/dashboard/client-script.ts";
import { esc } from "../../src/util/html-escape.ts";
import { isDevMode } from "../../src/util/dev-mode.ts";
import { parseGlobalFlags } from "../../src/cli/flags.ts";
import { luhnValid, redactString } from "../../src/observability/redaction.ts";
import { privateProviderAllowed, validateProviderUrl, validateProviderUrlSync } from "../../src/providers/provider-url-guard.ts";
import {
  CappedByteSink,
  CapExceededError,
  extensionBlocked,
  randomTempFileName,
  sanitizeFileLabel,
  sniffKind,
  validateAttachmentBytes,
} from "../../src/bots/attachment-guard.ts";
import { telegramSecretEquals } from "../../src/telegram/manager.ts";
import { Store } from "../../src/state/workspace-store.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "..", "..");
const req = (headers: Record<string, string> = {}, url = "http://127.0.0.1:7842/api/overview") =>
  new Request(url, { headers });

// ── A1 · security headers on every daemon response ───────────────────────────
describe("Phase 31 · A1 security headers", () => {
  test("JSON/API responses get the strict CSP and never-store", () => {
    const res = applySecurityHeaders(Response.json({ ok: true }), req());
    expect(res.headers.get("content-security-policy")).toBe(API_CSP);
    expect(API_CSP).toContain("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("HTML responses get the dashboard CSP + COOP/CORP", () => {
    const res = applySecurityHeaders(
      new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      req(),
    );
    expect(res.headers.get("content-security-policy")).toBe(DASHBOARD_CSP);
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("dashboard CSP: scripts are 'self'-only, no bare wildcards", () => {
    expect(DASHBOARD_CSP).toContain("script-src 'self'");
    expect(DASHBOARD_CSP).toContain("connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*");
    expect(DASHBOARD_CSP).not.toMatch(/(^|\s)\*(\s|;|$)/);
  });

  test("a route-level CSP wins over the central floor", () => {
    const res = applySecurityHeaders(
      new Response("<html></html>", {
        headers: { "content-type": "text/html", "content-security-policy": "default-src 'self'; script-src 'self'" },
      }),
      req(),
    );
    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'; script-src 'self'");
    // …but the non-negotiables are still applied.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("HSTS is https-only and SSE cache policy is preserved", () => {
    const httpRes = applySecurityHeaders(Response.json({}), req());
    expect(httpRes.headers.get("strict-transport-security")).toBeNull();

    const httpsRes = applySecurityHeaders(Response.json({}), req({}, "https://xr.local:7842/api/overview"));
    expect(httpsRes.headers.get("strict-transport-security")).toContain("max-age=31536000");

    const sse = applySecurityHeaders(
      new Response("", { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } }),
      req(),
    );
    expect(sse.headers.get("cache-control")).toBe("no-cache");
  });
});

// ── A6 · CORS never `*`, own-origin reflection only ──────────────────────────
describe("Phase 31 · A6 daemon CORS", () => {
  test("own origin is reflected exactly; foreign origins get nothing", () => {
    const own = new Headers();
    applyCorsHeaders(own, req({ origin: "http://127.0.0.1:7842" }));
    expect(own.get("access-control-allow-origin")).toBe("http://127.0.0.1:7842");

    const foreign = new Headers();
    applyCorsHeaders(foreign, req({ origin: "https://evil.example" }));
    expect(foreign.get("access-control-allow-origin")).toBeNull();

    const none = new Headers();
    applyCorsHeaders(none, req());
    expect(none.get("access-control-allow-origin")).toBeNull();
  });
});

// ── A2 · dashboard XSS: the served client's own escaping, executed ───────────
describe("Phase 31 · A2 dashboard escaping", () => {
  const extractFn = (name: string): string => {
    const start = DASHBOARD_SCRIPT.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = DASHBOARD_SCRIPT.indexOf("{", start); i < DASHBOARD_SCRIPT.length; i++) {
      if (DASHBOARD_SCRIPT[i] === "{") depth++;
      else if (DASHBOARD_SCRIPT[i] === "}" && --depth === 0) return DASHBOARD_SCRIPT.slice(start, i + 1);
    }
    throw new Error(`${name} not closed`);
  };
  const load = (name: string) =>
    new Function(`${extractFn(name)}; return ${name};`)() as (...args: unknown[]) => string;

  test("escapeHtml neutralises a script payload in element text", () => {
    const escapeHtml = load("escapeHtml");
    const out = escapeHtml('<script>alert(1)</script>');
    expect(out).not.toContain("<script>");
    expect(out).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("escapeHtml is attribute-safe for both quote styles", () => {
    const escapeHtml = load("escapeHtml");
    expect(escapeHtml(`a"b'c&d`)).toBe("a&quot;b&#39;c&amp;d");
  });

  test("act() serialises handler arguments without breaking the attribute", () => {
    const act = load("act");
    expect(act("navigateTo", 'x" onmouseover="alert(1)')).toBe(`navigateTo('x&quot; onmouseover=&quot;alert(1)')`);
    expect(act("answerApproval", "a&b", true)).toBe("answerApproval('a&amp;b', true)");
  });

  test("canonical server esc() matches the same contract", () => {
    expect(esc(`<a href="x">'&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;");
    expect(esc(null)).toBe("");
    expect(esc(42)).toBe("42");
  });

  test("served script has no unsafe HTML sinks left", () => {
    expect(DASHBOARD_SCRIPT).not.toContain("insertAdjacentHTML");
    expect(DASHBOARD_SCRIPT).not.toContain("document.write(");
  });
});

// ── A3 · webhook secret comparison ───────────────────────────────────────────
describe("Phase 31 · A3 Telegram webhook secret", () => {
  test("timing-safe compare: exact match only, length-agnostic", () => {
    const secret = "s".repeat(48);
    expect(telegramSecretEquals(secret, secret)).toBe(true);
    expect(telegramSecretEquals("s".repeat(47) + "x", secret)).toBe(false);
    expect(telegramSecretEquals("short", secret)).toBe(false);
    expect(telegramSecretEquals(null, secret)).toBe(false);
    expect(telegramSecretEquals(secret, null)).toBe(false);
    expect(telegramSecretEquals("", "")).toBe(false);
  });
});

// ── A4 · attachment guard ────────────────────────────────────────────────────
describe("Phase 31 · A4 attachment validation", () => {
  const mz = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
  const text = new TextEncoder().encode("quarterly numbers, all perfectly ordinary\n");

  test("executable extensions are blocked; source files are not", () => {
    expect(extensionBlocked("payload.EXE")).toBe(true);
    expect(extensionBlocked("run.ps1")).toBe(true);
    expect(extensionBlocked("app.apk")).toBe(true);
    expect(extensionBlocked("notes.txt")).toBe(false);
    expect(extensionBlocked("snippet.ts")).toBe(false);
  });

  test("magic bytes outrank the filename", () => {
    expect(sniffKind(mz)).toBe("exe");
    expect(validateAttachmentBytes({ name: "notes.txt", kind: "text", bytes: mz }).ok).toBe(false);
    expect(validateAttachmentBytes({ name: "report.pdf", kind: "pdf", bytes: mz }).ok).toBe(false);
    expect(validateAttachmentBytes({ name: "notes.txt", kind: "text", bytes: text }).ok).toBe(true);
    expect(validateAttachmentBytes({ name: "evil.exe", kind: "text", bytes: text }).ok).toBe(false);
  });

  test("size caps are enforced on the bytes in hand", () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(validateAttachmentBytes({ name: "photo.png", kind: "image", bytes: big }).ok).toBe(false);
  });

  test("the streaming sink aborts past the cap", () => {
    const sink = new CappedByteSink(4);
    sink.write(new Uint8Array(4));
    expect(() => sink.write(new Uint8Array(1))).toThrow(CapExceededError);
  });

  test("temp names are random hex; labels are metadata-safe", () => {
    expect(randomTempFileName("evil.exe")).toMatch(/^[0-9a-f]{16}\.exe$/);
    expect(randomTempFileName("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFileLabel("../../etc/passwd")).not.toContain("/");
  });
});

// ── A5 · SSRF guard for custom provider URLs ─────────────────────────────────
// NOTE: the test-suite preload opts into the escape hatch for loopback stub
// providers, so every call here passes an explicit env to stay deterministic.
describe("Phase 31 · A5 provider URL guard", () => {
  const noHatch = { env: {} as NodeJS.ProcessEnv };
  const hatch = { env: { XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER: "1" } as NodeJS.ProcessEnv };

  test("loopback http is refused without the hatch, allowed (loudly) with it", () => {
    const blocked = validateProviderUrlSync("http://127.0.0.1:1337/v1", noHatch);
    expect(blocked.ok).toBe(false);

    const allowed = validateProviderUrlSync("http://127.0.0.1:1337/v1", hatch);
    expect(allowed.ok).toBe(true);
    expect(allowed.allowedPrivate).toBe(true);
    expect(allowed.warnings.join(" ")).toContain("XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER=1");
  });

  test("cloud metadata and private ranges are refused", () => {
    expect(validateProviderUrlSync("https://169.254.169.254/latest/meta-data", noHatch).ok).toBe(false);
    expect(validateProviderUrlSync("http://100.100.100.200/", noHatch).ok).toBe(false);
    expect(validateProviderUrlSync("https://10.0.0.5:8443/v1", noHatch).ok).toBe(false);
    expect(validateProviderUrlSync("https://192.168.1.10/v1", noHatch).ok).toBe(false);
    expect(validateProviderUrlSync("https://metadata.google.internal/", noHatch).ok).toBe(false);
    expect(validateProviderUrlSync("https://localhost:11434/v1", noHatch).ok).toBe(false);
  });

  test("official providers are allow-listed over https only", () => {
    expect(validateProviderUrlSync("https://api.openai.com/v1", noHatch).ok).toBe(true);
    expect(validateProviderUrlSync("https://api.anthropic.com/v1", noHatch).ok).toBe(true);
    expect(validateProviderUrlSync("http://api.openai.com/v1", noHatch).ok).toBe(false);
  });

  test("public https passes; public http does not", () => {
    expect(validateProviderUrlSync("https://models.example.com/v1", noHatch).ok).toBe(true);
    expect(validateProviderUrlSync("http://models.example.com/v1", noHatch).ok).toBe(false);
    expect(validateProviderUrlSync("not a url", noHatch).ok).toBe(false);
  });

  test("DNS answers are re-checked (rebinding defence)", async () => {
    const clean = await validateProviderUrl("https://models.example.com/v1", {
      ...noHatch,
      resolve: async () => ["93.184.216.34"],
    });
    expect(clean.ok).toBe(true);

    const rebound = await validateProviderUrl("https://models.example.com/v1", {
      ...noHatch,
      resolve: async () => ["93.184.216.34", "169.254.169.254"],
    });
    expect(rebound.ok).toBe(false);
    expect(rebound.reason).toContain("169.254.169.254");
  });

  test("the hatch reader accepts only the literal '1'", () => {
    expect(privateProviderAllowed({ XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER: "1" })).toBe(true);
    expect(privateProviderAllowed({ XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER: "0" })).toBe(false);
    expect(privateProviderAllowed({})).toBe(false);
  });
});

// ── A8 · log redaction corpus ────────────────────────────────────────────────
describe("Phase 31 · A8 log redaction", () => {
  test("Luhn separates real PANs from other digit runs", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("123")).toBe(false);
    expect(redactString("card 4242424242424242 end")).toContain("⟨redacted:pan⟩");
    expect(redactString("ref 4242424242424241 end")).toContain("⟨redacted:card_number⟩");
  });

  test("secrets and PII never survive redactString", () => {
    const telegram = "123456789:" + "A".repeat(35);
    expect(redactString(`token ${telegram} ok`)).toContain("⟨redacted:telegram_token⟩");
    expect(redactString(`token ${telegram} ok`)).not.toContain(telegram);

    expect(redactString("Authorization: Bearer abcdefgh12345678")).toContain("⟨redacted:credential⟩");
    expect(redactString("sessionid=supersecretvalue; Path=/")).toBe("sessionid=⟨redacted:cookie⟩; Path=/");
    expect(redactString("mail dev@example.com please")).toBe("mail d***@example.com please");
    expect(redactString("call +92 300 1234567 now")).toContain("⟨redacted:phone⟩");
    expect(redactString("call 0300-1234567 now")).toContain("⟨redacted:phone⟩");
    expect(redactString("host 2001:0db8:85a3:0000:0000:8a2e:0370:7334 up")).toContain("⟨redacted:ip⟩");
    expect(redactString("ping 10.0.0.1 done")).toContain("⟨redacted:ip⟩");
  });

  test("ordinary log text is not mangled", () => {
    expect(redactString("started at 12:30:45 sharp")).toBe("started at 12:30:45 sharp");
    expect(redactString("build 2026-10-14 green")).toBe("build 2026-10-14 green");
  });
});

// ── A10 · strict pairing limiter + exponential backoff ───────────────────────
describe("Phase 31 · A10 pairing rate limits", () => {
  test("pairing paths are exactly the strict set", () => {
    for (const p of ["/api/telegram/pair", "/api/telegram/pair/open", "/api/discord/pair/open", "/api/whatsapp/pair", "/api/mobile/pair"]) {
      expect(STRICT_PAIRING_PATHS.has(p)).toBe(true);
    }
    expect(STRICT_PAIRING_PATHS.has("/api/overview")).toBe(false);
  });

  test("backoff: 5th failure blocks 1m, doubling to the 8m cap", () => {
    const b = new PairingFailureBackoff();
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) b.recordFailure("ip1", t0);
    expect(b.check("ip1", t0).allowed).toBe(true);

    b.recordFailure("ip1", t0); // 5th → 1 minute
    const blocked = b.check("ip1", t0);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBe(60);
    expect(b.check("ip1", t0 + 61_000).allowed).toBe(true);

    b.recordFailure("ip1", t0); // 6th → 2 minutes
    expect(b.check("ip1", t0 + 119_000).allowed).toBe(false);
    expect(b.check("ip1", t0 + 121_000).allowed).toBe(true);

    b.recordFailure("ip1", t0); // 7th → 4m
    b.recordFailure("ip1", t0); // 8th → 8m cap
    expect(b.check("ip1", t0 + 479_000).allowed).toBe(false);
    expect(b.check("ip1", t0 + 481_000).allowed).toBe(true);

    b.recordSuccess("ip1");
    expect(b.check("ip1", t0).allowed).toBe(true);
    expect(b.failuresFor("ip1")).toBe(0);
  });

  test("the strict limiter allows 10/minute then refuses with Retry-After data", () => {
    const limiter = new RateLimiter(10, 60_000);
    const t0 = 5_000_000;
    for (let i = 0; i < 10; i++) expect(limiter.allow("ip9", t0)).toBe(true);
    expect(limiter.allow("ip9", t0)).toBe(false);
    expect(limiter.retryAfterSeconds("ip9", t0)).toBeGreaterThan(0);
    expect(limiter.allow("ip9", t0 + 60_001)).toBe(true);
  });
});

// ── A12 · dev-mode gating ────────────────────────────────────────────────────
describe("Phase 31 · A12 dev-mode gates", () => {
  test("isDevMode requires the explicit opt-in", () => {
    const saved = globalThis.__XR_DEV__;
    try {
      globalThis.__XR_DEV__ = undefined;
      expect(isDevMode({})).toBe(false);
      expect(isDevMode({ XR_DEV: "0" })).toBe(false);
      expect(isDevMode({ XR_DEV: "1" })).toBe(true);
      globalThis.__XR_DEV__ = true;
      expect(isDevMode({})).toBe(true);
    } finally {
      globalThis.__XR_DEV__ = saved;
    }
  });

  test("--verbose/--debug parse as no-ops outside dev mode", () => {
    const savedDev = process.env.XR_DEV;
    const savedGlobal = globalThis.__XR_DEV__;
    try {
      delete process.env.XR_DEV;
      globalThis.__XR_DEV__ = undefined;
      const gated = parseGlobalFlags(["--verbose", "--debug", "models"]);
      expect(gated.verbose).toBe(false);
      expect(gated.debug).toBe(false);
      expect(gated.args).toContain("models");

      process.env.XR_DEV = "1";
      const dev = parseGlobalFlags(["--verbose", "models"]);
      expect(dev.verbose).toBe(true);
    } finally {
      if (savedDev === undefined) delete process.env.XR_DEV;
      else process.env.XR_DEV = savedDev;
      globalThis.__XR_DEV__ = savedGlobal;
      delete process.env.XR_DEBUG;
    }
  });
});

// ── Handler-level: A1/A6/A13 on real daemon responses ────────────────────────
describe("Phase 31 · daemon handler integration", () => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-p31-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  const TOKEN = "p31-test-token";
  const handler = makeHandler(store, TOKEN);
  const call = (path: string, headers: Record<string, string> = {}) =>
    handler(new Request(`http://127.0.0.1:7842${path}`, { headers }));

  test("A13: security.txt redirects to the website copy, no auth needed", async () => {
    const res = await call("/.well-known/security.txt");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(SECURITY_TXT_URL);
    expect(SECURITY_TXT_URL).toBe("https://xr.rrrtx.ai/.well-known/security.txt");
  });

  test("A1: HEAD probes route as GET (curl -I works)", async () => {
    const res = await handler(
      new Request("http://127.0.0.1:7842/api/health", { method: "HEAD" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(API_CSP);
  });

  test("A1/A6: health answers carry headers; CORS reflects only its own origin", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(API_CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();

    const own = await call("/api/health", { origin: "http://127.0.0.1:7842" });
    expect(own.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:7842");

    const foreign = await call("/api/health", { origin: "https://evil.example" });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });
});

// ── Static tripwires for surfaces unit tests cannot reach ────────────────────
// A7/A9/A11/A14/A15 live in other toolchains (Vite, Next, Tauri, CI shell).
// These assertions fail loudly if the hardening is ever deleted, which is
// the most a root-suite test can honestly promise for them.
describe("Phase 31 · static tripwires (A7/A9/A11/A14/A15)", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  test("A7: source maps are off in production builds", () => {
    expect(read("website/next.config.ts")).toContain("productionBrowserSourceMaps: false");
    expect(read("mobile/vite.config.ts")).toContain("sourcemap: false");
    expect(read("desktop/vite.config.ts")).toContain("sourcemap: !!process.env.TAURI_ENV_DEBUG");
    expect(read("desktop/src-tauri/Cargo.toml")).toContain("debug = false");
  });

  test("A9/A13: website serves security headers and discovery files", () => {
    const cfg = read("website/next.config.ts");
    expect(cfg).toContain("async headers()");
    expect(cfg).toContain("X-Content-Type-Options");
    expect(cfg).toContain("Content-Security-Policy");
    expect(cfg).toContain("Strict-Transport-Security");
    expect(existsSync(join(ROOT, "website/src/app/.well-known/security.txt/route.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "website/src/app/robots.ts"))).toBe(true);
  });

  test("A11: the audit gate script and CI wiring exist", () => {
    expect(existsSync(join(ROOT, "scripts/audit-deps.sh"))).toBe(true);
    expect(read("scripts/audit-deps.sh")).toContain("bun audit --json");
    expect(read(".github/workflows/ci.yml")).toContain("scripts/audit-deps.sh");
  });

  test("A14: desktop refuses credential persistence through the actual extracted safety policy", async () => {
    const transport = read("desktop/src/engine/transport.ts");
    expect(transport).not.toContain("localStorage.setItem(DEV_SESSION_KEY");
    expect(transport).toContain("devSessionMemory");
    const storeSrc = read("desktop/src/lib/persistent-store.ts");
    expect(storeSrc).toContain("isSensitiveSettingKey");
    const {isSensitiveSettingKey,assertSafeSetting}=await import("../../desktop/src/lib/persistent-safety");
    for(const key of ["xr.providerkeys","api_key","access_token","password"]) {
      expect(isSensitiveSettingKey(key)).toBe(true);expect(()=>assertSafeSetting(key,"fixture")).toThrow();
    }
    expect(isSensitiveSettingKey("xr.theme")).toBe(false);
    expect(()=>assertSafeSetting("xr.model.default",{model:"fixture",nested:{apiKey:"fixture-not-real"}})).toThrow();
  });

  test("A15: Tauri CSP keeps loopback http+ws and no bare wildcards", () => {
    const conf = JSON.parse(read("desktop/src-tauri/tauri.conf.json")) as {
      app: { security: { csp: string } };
    };
    const csp = conf.app.security.csp;
    expect(csp).toContain("http://127.0.0.1:*");
    expect(csp).toContain("ws://127.0.0.1:*");
    for (const token of csp.split(/[\s;]+/)) {
      expect(token).not.toBe("*");
      expect(token).not.toMatch(/^[a-z]+:\/\/\*$/);
    }
  });
});

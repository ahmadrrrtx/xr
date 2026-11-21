import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchEvidence, redactEvidence, shellEngineView, webviewEngineSmoke, webviewOnboardingSmoke } from "../../scripts/journey/desktop-journey.ts";

test("fresh native install requires onboarding rather than a splash or false crash screen", async () => {
  expect(await webviewOnboardingSmoke(async () => ({ welcome: true, splash: false, recovery: false }), "fixture", 0)).toContain("onboarding rendered");
  for (const broken of [{ welcome: false, splash: true }, { welcome: false, recovery: true }, { welcome: true, recovery: true }]) {
    await expect(webviewOnboardingSmoke(async () => broken, "fixture", 0)).rejects.toThrow("fresh-home onboarding failed");
  }
});

// WebDriver protocol unit fixtures only. Actual native proof requires running
// desktop-journey.ts --webdriver against a freshly installed real artifact.
const valid = { linked: true, health: 200, meta: 200, contract: 1, anonymousMeta: 401, wrongSessionMeta: 401,
  providers: 200, catalog: 200, providerCount: 26, modelCount: 84, mappedProviders: true, configuredChoiceIncluded: true };

test("native journey requires webview-authenticated full catalog and configured model mapping", async () => {
  const wd = async (_method: string, _path: string, body?: unknown) => {
    const s = JSON.stringify(body);
    for (const marker of ["engine_link", "/meta/version", "Authorization", "/providers/catalog", "p.primary", "p.model"])
      expect(s).toContain(marker);
    return valid;
  };
  expect(await webviewEngineSmoke(wd, "fixture")).toContain("webview authenticated");
});

test("native journey fails rather than claiming success when webview fetch fails", async () => {
  await expect(webviewEngineSmoke(async () => ({ error: "webview request failed" }), "fixture"))
    .rejects.toThrow("webview-to-engine handshake failed");
  await expect(webviewEngineSmoke(async () => ({ linked: true, health: 200, meta: 401 }), "fixture"))
    .rejects.toThrow("webview-to-engine handshake failed");
});

for (const broken of [{ modelCount: 4 }, { providerCount: 4 }, { configuredChoiceIncluded: false }, { mappedProviders: false },
  { anonymousMeta: 200 }, { wrongSessionMeta: 200 }, { catalog: 401 }]) {
  test(`native journey refuses incomplete/unauthenticated catalog proof: ${JSON.stringify(broken)}`, async () => {
    await expect(webviewEngineSmoke(async () => ({ ...valid, ...broken }), "fixture"))
      .rejects.toThrow("webview full catalog/auth/configuration proof failed");
  });
}

/** Runs a WebDriver execute/async script against a fake webview, the way the driver wraps it. */
function fakeWebview(engineLink: () => Promise<unknown>) {
  const window = { __TAURI_INTERNALS__: { invoke: async (cmd: string) => { expect(cmd).toBe("engine_link"); return engineLink(); } } };
  return async (_method: string, _path: string, body?: unknown) => {
    const { script } = body as { script: string };
    const run = new Function("window", "done", `(function () { ${script} })(done);`) as (w: typeof window, done: (v: unknown) => void) => void;
    return new Promise((resolve) => run(window, resolve));
  };
}

test("a launch failure carries the shell's own engine view, never the engine token", async () => {
  const token = "f".repeat(48);
  const linked = await shellEngineView(fakeWebview(async () => ({ reachable: true, spawned: true, port: 49152, token, containmentMode: "job-object", stderr: ["a", "b", "c", "d"] })), "fixture");
  expect(linked).not.toContain(token);
  expect(linked).toContain('"hasToken":true');
  expect(linked).toContain('"port":49152');
  expect(linked).toContain('"stderr":["b","c","d"]');
  const booting = await shellEngineView(fakeWebview(async () => ({ reachable: false, spawned: true, port: null, hasToken: false, reason: null, stderr: [] })), "fixture");
  expect(booting).toContain('"spawned":true');
  expect(booting).toContain('"hasToken":false');
  expect(await shellEngineView(async () => { throw new Error("no session"); }, "fixture")).toContain("unavailable (no session)");
});

test("launch evidence carries only the shell's lifecycle lines and the crash flag, redacted (NEW-7)", async () => {
  const home = mkdtempSync(join(tmpdir(), "xr-launch-evidence-"));
  try {
    const engineHome = join(home, ".xr-desktop");
    mkdirSync(join(engineHome, "logs"), { recursive: true });
    const token = "a".repeat(48);
    writeFileSync(join(engineHome, "logs", "shell.log"), [
      "[1795180000000] session start: pid 4242 version 1.2.0-preview.1 interruption-count 1 engine-failed false",
      `[1795180000001] debug dump token=${token} path=${home}/secret`,
      `[1795180008000] engine down: spawn failed: ${home}/.xr-desktop/bin missing (key ${"b".repeat(40)})`,
    ].join("\n"));
    writeFileSync(join(engineHome, "crash-dirty.json"), "{}");
    const evidence = await launchEvidence(engineHome, home);
    expect(evidence).toContain("session start: pid 4242");
    expect(evidence).toContain("engine down: spawn failed: $HOME/.xr-desktop/bin missing (key [redacted])");
    expect(evidence).toContain("crash flag present (no clean exit)");
    expect(evidence).not.toContain("debug dump");
    expect(evidence).not.toContain(token);
    expect(evidence).not.toContain(home);
    const absent = await launchEvidence(join(home, "absent"), home);
    if (process.platform === "win32") expect(absent).toStartWith("no shell log; no crash flag; windows: ");
    else expect(absent).toBe("no shell log; no crash flag");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("launch evidence says so when the app wrote its shell log to the default desktop home instead (NEW-7)", async () => {
  const home = mkdtempSync(join(tmpdir(), "xr-launch-evidence-default-"));
  try {
    const fallback = join(home, "profile", ".xr-desktop");
    mkdirSync(join(fallback, "logs"), { recursive: true });
    writeFileSync(join(fallback, "logs", "shell.log"), "[1795180000000] session start: pid 7 version 1.2.0-preview.1 interruption-count 1 engine-failed false\n");
    const evidence = await launchEvidence(join(home, ".xr-desktop"), home, fallback);
    expect(evidence).toStartWith("shell log only in the DEFAULT desktop home: session start: pid 7");
    expect(evidence).not.toContain(home);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("evidence redaction removes token-shaped values and the scratch home", () => {
  expect(redactEvidence(`Authorization: Bearer abc.def /tmp/h/x ${"c".repeat(32)}`, "/tmp/h")).toBe("Authorization: [redacted] $HOME/x [redacted]");
  expect(redactEvidence("api_key=sk-live-123; token: xyz, ok", "")).toBe("api_key=[redacted]; token: [redacted], ok");
});


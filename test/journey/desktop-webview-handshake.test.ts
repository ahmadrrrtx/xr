import { expect, test } from "bun:test";
import { shellEngineView, webviewEngineSmoke, webviewOnboardingSmoke } from "../../scripts/journey/desktop-journey.ts";

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

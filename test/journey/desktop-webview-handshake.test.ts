import { expect, test } from "bun:test";
import { webviewEngineSmoke } from "../../scripts/journey/desktop-journey.ts";

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

import { expect, test } from "bun:test";
import { webviewEngineSmoke } from "../../scripts/journey/desktop-journey.ts";

test("native journey requires webview health and authenticated contract", async () => {
  const wd = async (_method: string, _path: string, body?: unknown) => {
    const s = JSON.stringify(body);
    expect(s).toContain("engine_link");
    expect(s).toContain("/meta/version");
    expect(s).toContain("Authorization");
    return { linked: true, health: 200, meta: 200, contract: 1 };
  };
  expect(await webviewEngineSmoke(wd, "fixture")).toContain("webview authenticated");
});

test("native journey fails rather than claiming success when webview fetch fails", async () => {
  await expect(webviewEngineSmoke(async () => ({ error: "webview request failed" }), "fixture"))
    .rejects.toThrow("webview-to-engine handshake failed");
  await expect(webviewEngineSmoke(async () => ({ linked: true, health: 200, meta: 401 }), "fixture"))
    .rejects.toThrow("webview-to-engine handshake failed");
});

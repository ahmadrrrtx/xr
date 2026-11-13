import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDevice, listDevices } from "../../src/daemon/mobile-devices.ts";
import { createChat, listChats } from "../../src/daemon/mobile-chats.ts";
import { ensureVapidKeys } from "../../src/daemon/web-push.ts";

test("mobile device, chat and push caches follow the selected data home", async () => {
  const old = { HOME: process.env.HOME, XR_HOME: process.env.XR_HOME, XR_SECRET_NAMESPACE: process.env.XR_SECRET_NAMESPACE };
  const home = mkdtempSync(join(tmpdir(), "xr-mobile-profile-"));
  try {
    process.env.HOME = home;
    process.env.XR_HOME = join(home, "desktop");
    process.env.XR_SECRET_NAMESPACE = "cli";
    await addDevice({ name: "cli device", kind: "mobile" });
    await createChat("cli chat");
    const cliKey = (await ensureVapidKeys()).publicKey;
    process.env.XR_SECRET_NAMESPACE = "desktop";
    expect(await listDevices()).toEqual([]);
    expect(await listChats()).toEqual([]);
    await addDevice({ name: "desktop device", kind: "mobile" });
    await createChat("desktop chat");
    const desktopKey = (await ensureVapidKeys()).publicKey;
    expect(desktopKey).not.toBe(cliKey);
    process.env.XR_SECRET_NAMESPACE = "cli";
    expect((await listDevices()).map((d) => d.name)).toEqual(["cli device"]);
    expect((await listChats()).map((c) => c.title)).toEqual(["cli chat"]);
    expect((await ensureVapidKeys()).publicKey).toBe(cliKey);
    process.env.XR_SECRET_NAMESPACE = "desktop";
    expect((await listDevices()).map((d) => d.name)).toEqual(["desktop device"]);
    expect((await listChats()).map((c) => c.title)).toEqual(["desktop chat"]);
    expect((await ensureVapidKeys()).publicKey).toBe(desktopKey);
  } finally {
    for (const key of Object.keys(old) as (keyof typeof old)[]) {
      if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    }
    rmSync(home, { recursive: true, force: true });
  }
});

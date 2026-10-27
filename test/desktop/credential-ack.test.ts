import { expect, test } from "bun:test";
import {
  purgeCredentialCopies,
  type LegacyBrowserStore,
  type LegacyNativeStore,
} from "../../desktop/src/lib/credential-migration";
function browser() {
  const values = new Map([
    ["xr.providerKeys", JSON.stringify({ openai: "fixture-private-key" })],
    [
      "xr.model.default",
      JSON.stringify({
        source: "cloud",
        providerId: "google",
        model: "gemini-3.8-flash",
        apiKey: "fixture-private-key",
      }),
    ],
  ]);
  const storage: LegacyBrowserStore = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  return { values, storage };
}
function native() {
  const values = new Map<string, unknown>([
    ["xr.providerKeys", { openai: "fixture-private-key" }],
    [
      "xr.model.default",
      JSON.stringify({
        source: "cloud",
        providerId: "google",
        model: "gemini-3.8-flash",
        apiKey: "fixture-private-key",
      }),
    ],
  ]);
  const storage: LegacyNativeStore = {
    async get<T>(k: string) {
      return values.get(k) as T | undefined;
    },
    async set(k, v) {
      values.set(k, v);
    },
    async save() {},
  };
  return { values, storage };
}
test("native-plugin absence cannot silently downgrade a credential cleanup to browser-only success", async () => {
  const b = browser();
  await expect(purgeCredentialCopies(null, b.storage, true)).rejects.toThrow(
    "unavailable",
  );
  expect(b.values.has("xr.providerKeys")).toBe(true);
});
test("native and browser copies must both acknowledge removal, retaining the qualified selection only", async () => {
  const b = browser(),
    n = native();
  expect(await purgeCredentialCopies(n.storage, b.storage, true)).toBe(true);
  expect(JSON.stringify([...n.values, ...b.values])).not.toContain(
    "fixture-private-key",
  );
  expect(n.values.get("xr.model.default")).toBe("google/gemini-3.8-flash");
  expect(JSON.parse(b.values.get("xr.model.default")!)).toBe(
    "google/gemini-3.8-flash",
  );
  expect(await purgeCredentialCopies(n.storage, b.storage, true)).toBe(false);
});
for (const op of ["get", "set", "save"] as const)
  test(`native ${op} failure cannot report confirmed cleanup`, async () => {
    const n = native(),
      b = browser();
    Object.assign(n.storage, {
      [op]: async () => {
        throw new Error(`fixture ${op} unavailable`);
      },
    });
    await expect(
      purgeCredentialCopies(n.storage, b.storage, true),
    ).rejects.toThrow("unavailable");
    expect(b.values.has("xr.providerKeys")).toBe(true);
  });
test("a native port that returns success but retains its old data is detected", async () => {
  const n = native(),
    b = browser();
  n.storage.set = async () => {};
  await expect(
    purgeCredentialCopies(n.storage, b.storage, true),
  ).rejects.toThrow("not retained");
  expect(b.values.has("xr.providerKeys")).toBe(true);
});
test("browser refusal or false acknowledgment cannot report completed cleanup", async () => {
  const b = browser();
  b.storage.removeItem = () => {};
  await expect(purgeCredentialCopies(null, b.storage)).rejects.toThrow(
    "not retained",
  );
  b.storage.removeItem = () => {
    throw new Error("fixture browser storage unavailable");
  };
  await expect(purgeCredentialCopies(null, b.storage)).rejects.toThrow(
    "unavailable",
  );
});

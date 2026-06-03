/**
 * XR — Block 9 tests: i18n + signed audit export.
 */
import { test, expect } from "bun:test";
import { t, pickLang, isRTL } from "../src/i18n/strings.ts";
import { buildAuditReport, verifyAuditReport } from "../src/export/report.ts";

// ---- i18n ----
test("pickLang detects language from locale string", () => {
  expect(pickLang("ur_PK")).toBe("ur");
  expect(pickLang("ar-SA")).toBe("ar");
  expect(pickLang("es_ES")).toBe("es");
  expect(pickLang("en_US")).toBe("en");
  expect(pickLang("zz")).toBe("en"); // fallback
});

test("t returns translated strings with English fallback", () => {
  expect(t("approve", "en")).toBe("Approve");
  expect(t("approve", "ur")).toBe("منظور");
  expect(t("approve", "ar")).toBe("موافقة");
  expect(t("approve", "es")).toBe("Aprobar");
  expect(t("nonexistent_key", "ur")).toBe("nonexistent_key"); // key fallback
});

test("isRTL true for Urdu/Arabic only", () => {
  expect(isRTL("ur")).toBe(true);
  expect(isRTL("ar")).toBe(true);
  expect(isRTL("en")).toBe(false);
  expect(isRTL("es")).toBe(false);
});

// ---- signed audit export ----
const sample = {
  project: "demo",
  chainValid: true,
  blockRate: 0.9,
  totalUsd: 0.0312,
  entries: [
    { event: "session.start", detail: "{}", hash: "aaaa1111bbbb2222", created_at: 1_750_000_000_000 },
    { event: "write_file.applied", detail: "{}", hash: "cccc3333dddd4444", created_at: 1_750_000_060_000 },
  ],
};

test("buildAuditReport produces markdown + signature", () => {
  const r = buildAuditReport(sample);
  expect(r.markdown).toContain("# XR Audit Report — demo");
  expect(r.markdown).toContain("INTACT");
  expect(r.markdown).toContain("90%");
  expect(r.sha256).toHaveLength(64);
  expect(r.markdown).toContain("xr-signature: " + r.sha256);
});

test("verifyAuditReport validates an untouched report", () => {
  const r = buildAuditReport(sample);
  const v = verifyAuditReport(r.markdown);
  expect(v.valid).toBe(true);
  expect(v.sha256).toBe(r.sha256);
});

test("verifyAuditReport detects tampering", () => {
  const r = buildAuditReport(sample);
  const tampered = r.markdown.replace("write_file.applied", "deleted_everything");
  expect(verifyAuditReport(tampered).valid).toBe(false);
});

test("verifyAuditReport handles missing signature", () => {
  expect(verifyAuditReport("just some text, no signature").valid).toBe(false);
});

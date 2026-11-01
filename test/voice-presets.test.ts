/**
 * Voice preset catalogue (2026-11-01 revision) — guards the "Ahmad must be a
 * boy" contract at the data level.
 *
 * The original bug: the voice labelled "Ahmad · male" was Piper
 * `en_US-lessac-medium`, which is a FEMALE voice. These tests pin each named
 * preset to a piper voice of the correct gender so a future edit cannot
 * silently reintroduce the mismatch, and verify the download manifest
 * integrity inputs (file byte sizes must be present and distinct per file).
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_TTS_VOICE, TTS_VOICES } from "../src/voice/models.ts";

/** Piper voice genders from the piper project's voice catalogue. */
const PIPER_GENDER: Record<string, "male" | "female"> = {
  "en_US-kusal-medium": "male",
  "en_US-ryan-medium": "male",
  "en_US-joe-medium": "male",
  "en_US-aron-medium": "male",
  "en_GB-alan-medium": "male",
  "en_GB-northern_english_male-medium": "male",
  "en_US-lessac-medium": "female",
  "en_US-amy-medium": "female",
  "en_US-kristin-medium": "female",
  "en_GB-jenny_dioco-medium": "female",
};

const BY_LABEL = new Map(TTS_VOICES.map((v) => [v.label!, v]));

test("the four named presets exist", () => {
  for (const label of ["Ahmad", "Nova", "Atlas", "Sage"]) {
    expect(BY_LABEL.has(label)).toBe(true);
  }
  expect(TTS_VOICES.length).toBe(4);
});

test("Ahmad is a male (boy) piper voice and the default", () => {
  const ahmad = BY_LABEL.get("Ahmad")!;
  expect(ahmad.id).toBe("piper-kusal");
  expect(ahmad.gender).toBe("male");
  expect(PIPER_GENDER[ahmad.name.replace("Piper ", "")]).toBe("male");
  expect(DEFAULT_TTS_VOICE).toBe("piper-kusal");
});

test("every preset's engine gender matches the piper voice's real gender", () => {
  for (const v of TTS_VOICES) {
    const model = v.name.replace("Piper ", "");
    const real = PIPER_GENDER[model];
    expect(real, `${model} must be a known piper voice`).toBeDefined();
    expect(v.gender).toBe(real);
  }
});

test("the rejected female-voiced set is gone", () => {
  const ids = TTS_VOICES.map((v) => v.id);
  expect(ids).not.toContain("piper-lessac");
  expect(ids).not.toContain("piper-jenny");
  expect(ids).not.toContain("piper-alan");
});

test("download manifests are complete and internally distinct", () => {
  for (const v of TTS_VOICES) {
    expect(v.files.length).toBe(3);
    const paths = v.files.map((f) => f.path);
    expect(new Set(paths).size).toBe(3);
    for (const f of v.files) {
      expect(f.bytes).toBeGreaterThan(0);
      expect(f.url).toContain('vits-piper-');
    }
    // The ONNX is the payload; tokens/json are tiny sidecars.
    const onnx = v.files.find((f) => f.path.endsWith(".onnx"))!;
    expect(onnx.bytes).toBeGreaterThan(60_000_000);
    const json = v.files.find((f) => f.path.endsWith(".onnx.json"))!;
    expect(json.bytes).toBeLessThan(10_000);
  }
});

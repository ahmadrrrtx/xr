/**
 * XR 4.4 — Capability tri-state + descriptor mapping tests.
 */
import { describe, test, expect } from "bun:test";
import {
  fromBool,
  fromLegacyCapabilities,
  isSupported,
  modelsFromPreset,
  emptyCapabilities,
  capabilityRequired,
  classesFromCapabilities,
} from "../../src/intelligence/capability.ts";
import { PRESETS } from "../../src/providers/presets.ts";

describe("XR 4.4 capability tri-state", () => {
  test("fromBool distinguishes unknown from unsupported", () => {
    expect(fromBool(true)).toBe("supported");
    expect(fromBool(false)).toBe("unsupported");
    expect(fromBool(undefined)).toBe("unknown");
  });

  test("unknown is never treated as supported", () => {
    const caps = emptyCapabilities("unknown");
    expect(isSupported(caps.toolUse)).toBe(false);
    expect(capabilityRequired(caps, "toolUse").ok).toBe(false);
    expect(capabilityRequired(caps, "toolUse", { allowUnknown: true }).ok).toBe(true);
  });

  test("legacy boolean map preserves chat and maps optionals", () => {
    const caps = fromLegacyCapabilities({
      chat: true,
      toolUse: true,
      vision: false,
    });
    expect(caps.chat).toBe("supported");
    expect(caps.toolUse).toBe("supported");
    expect(caps.vision).toBe("unsupported");
    expect(caps.embeddings).toBe("unknown");
  });

  test("ollama preset expands to model descriptors with local locality", () => {
    const models = modelsFromPreset(PRESETS.ollama, true);
    expect(models.length).toBeGreaterThan(0);
    const def = models.find((m) => m.isDefault);
    expect(def?.providerId).toBe("ollama");
    expect(def?.locality.locality).toBe("local");
    expect(def?.locality.leavesMachine).toBe(false);
    expect(def?.cost.free).toBe(true);
    expect(def?.capabilities.chat).toBe("supported");
  });

  test("openai preset marks vision/embeddings when declared", () => {
    const models = modelsFromPreset(PRESETS.openai, true);
    const def = models.find((m) => m.isDefault)!;
    expect(def.capabilities.vision).toBe("supported");
    expect(def.capabilities.embeddings).toBe("supported");
    expect(def.locality.locality).toBe("cloud");
    expect(classesFromCapabilities(def.capabilities)).toContain("chat");
  });

  test("embedding model id refines chat to unsupported", () => {
    const models = modelsFromPreset(
      {
        ...PRESETS.openai,
        defaultModel: "text-embedding-3-small",
        knownModels: ["text-embedding-3-small"],
      },
      true,
    );
    expect(models[0]!.capabilities.embeddings).toBe("supported");
    expect(models[0]!.capabilities.chat).toBe("unsupported");
  });
});

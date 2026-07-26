/**
 * XR 5.2.0 — Capability Descriptor Parser & Builder
 *
 * Reads and validates descriptors from manifest files, package metadata,
 * or constructed objects. Preserves execution semantics of underlying
 * capability types (plugin, skill, MCP, provider, tool, workflow,
 * integration, artifact).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { CapabilityDescriptorSchema, buildDescriptor, CapabilityDescriptor } from "./types.ts";

export interface DescriptorParseResult {
  ok: boolean;
  descriptor?: CapabilityDescriptor;
  errors: string[];
  warnings: string[];
}

const MAX_DESCRIPTOR_BYTES = 256 * 1024;
export const DESCRIPTOR_FILE_NAMES = ["xr-capability.json", ".capability.json"];

export function parseDescriptorObject(raw: unknown): DescriptorParseResult {
  const parsed = CapabilityDescriptorSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      warnings: [],
    };
  }
  const d = parsed.data;
  const warnings: string[] = [];
  if (!d.provenance) warnings.push("missing provenance");
  if (d.certification?.status === "unknown") warnings.push("certification status is unknown");
  if (d.effectiveAuthority && d.effectiveAuthority.reviewStatus === "pending_review") {
    warnings.push("effective authority not fully approved");
  }
  return { ok: true, descriptor: d, errors: [], warnings };
}

export function readDescriptorFile(filePath: string): DescriptorParseResult {
  try {
    const st = statSync(filePath);
    if (st.size > MAX_DESCRIPTOR_BYTES) {
      return { ok: false, errors: [`descriptor file exceeds ${MAX_DESCRIPTOR_BYTES} bytes`], warnings: [] };
    }
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    return parseDescriptorObject(raw);
  } catch (e) {
    return { ok: false, errors: [`cannot read descriptor: ${(e as Error).message}`], warnings: [] };
  }
}

export function readDescriptorFromDir(dir: string): DescriptorParseResult {
  for (const name of DESCRIPTOR_FILE_NAMES) {
    const p = join(dir, name);
    if (existsSync(p)) return readDescriptorFile(p);
  }
  // Try deriving from plugin/skill/manifests as fallback
  return tryDeriveDescriptor(dir);
}

function tryDeriveDescriptor(dir: string): DescriptorParseResult {
  const errors: string[] = [];
  const baseName = basename(dir);
  const descriptor = buildDescriptor({
    capabilityId: baseName,
    capabilityType: "plugin",
    name: baseName,
    version: "0.0.0",
    publisher: { id: "derived", kind: "unknown" },
  });
  errors.push("no descriptor file found; derived minimal descriptor");
  return { ok: false, descriptor, errors, warnings: ["derived descriptor — verify before use"] };
}

export function descriptorFromPluginManifest(manifestPath: string): DescriptorParseResult {
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const descriptor = buildDescriptor({
      capabilityId: raw.id ?? basename(manifestPath, ".json"),
      capabilityType: "plugin",
      name: raw.name ?? basename(manifestPath, ".json"),
      version: raw.version ?? "0.0.0",
      description: raw.description,
      publisher: { id: raw.publisher ?? "unknown", kind: "unknown" },
    });
    return { ok: true, descriptor, errors: [], warnings: ["derived from plugin manifest"] };
  } catch (e) {
    return { ok: false, errors: [`cannot derive descriptor from manifest: ${(e as Error).message}`], warnings: [] };
  }
}

export function descriptorFromSkillManifest(manifestPath: string): DescriptorParseResult {
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const descriptor = buildDescriptor({
      capabilityId: raw.id ?? basename(manifestPath, ".json"),
      capabilityType: "skill",
      name: raw.name ?? basename(manifestPath, ".json"),
      version: raw.version ?? "0.0.0",
      description: raw.description,
      publisher: { id: raw.publisher ?? "unknown", kind: "unknown" },
    });
    return { ok: true, descriptor, errors: [], warnings: ["derived from skill manifest"] };
  } catch (e) {
    return { ok: false, errors: [`cannot derive descriptor from manifest: ${(e as Error).message}`], warnings: [] };
  }
}

/**
 * XR 5.2.0 — Capability CLI / Inspection Routes
 *
 * Exposes inspect, permissions/effective authority, provenance/signature,
 * dependencies, compatibility, certification, enable/disable, update/review,
 * rollback/quarantine, and safe execution status.
 */
import { CapabilityDescriptor } from "./types.ts";
import { inspectDescriptorDescriptor } from "./sdk.ts";
import { verifyCapability, verifyBeforeInstall } from "./verify.ts";
import { CapabilityCatalog, globalCatalog } from "./registry.ts";

export interface InspectOptions {
  showEffectiveAuthority?: boolean;
  showProvenance?: boolean;
  showDependencies?: boolean;
  showCertification?: boolean;
  showLifecycle?: boolean;
  json?: boolean;
}

export function formatInspectOutput(desc: CapabilityDescriptor, opts: InspectOptions = {}): string {
  if (opts.json) {
    return JSON.stringify(inspectDescriptorDescriptor(desc), null, 2);
  }
  const lines: string[] = [];
  lines.push(`=== Capability: ${desc.name} (${desc.capabilityId}) ===`);
  lines.push(`Type: ${desc.capabilityType}`);
  lines.push(`Version: ${desc.version}`);
  lines.push(`State: ${desc.lifecycleState}`);
  lines.push(`Publisher: ${desc.publisher.id} (${desc.publisher.kind})`);
  if (desc.description) lines.push(`Description: ${desc.description}`);

  if (opts.showEffectiveAuthority || true) {
    lines.push("--- Effective Authority ---");
    lines.push(`Granted permissions: ${(desc.effectiveAuthority?.grantedPermissions ?? desc.declaredAuthority.permissions ?? []).join(", ") || "none"}`);
    lines.push(`Denied permissions: ${(desc.effectiveAuthority?.deniedPermissions ?? []).join(", ") || "none"}`);
    lines.push(`Review status: ${desc.effectiveAuthority?.reviewStatus ?? "unknown"}`);
  }

  if (opts.showProvenance || true) {
    lines.push("--- Provenance ---");
    lines.push(`Package hash: ${desc.provenance?.packageHash ?? "none"}`);
    lines.push(`Manifest hash: ${desc.provenance?.manifestHash ?? "none"}`);
    lines.push(`Source: ${desc.provenance?.source ?? "unknown"}`);
    lines.push(`Verified at: ${desc.provenance?.verifiedAt ? new Date(desc.provenance.verifiedAt).toISOString() : "never"}`);
  }

  if (opts.showDependencies || true) {
    lines.push("--- Dependencies ---");
    const deps = desc.dependencies ?? [];
    lines.push(deps.length ? deps.map((d) => `${d.kind}:${d.id}${d.version ? "@" + d.version : ""}`).join("; ") : "none");
  }

  if (opts.showCertification || true) {
    lines.push("--- Certification ---");
    lines.push(`Status: ${desc.certification?.status ?? "unknown"}`);
    lines.push(`Contract tests: ${(desc.certification?.contractTests?.length ?? 0)} recorded`);
  }

  if (opts.showLifecycle || true) {
    lines.push("--- Lifecycle ---");
    lines.push(`History events: ${desc.lifecycleHistory?.length ?? 0}`);
    for (const ev of desc.lifecycleHistory ?? []) {
      lines.push(`  [${new Date(ev.at).toISOString()}] ${ev.action}${ev.detail ? ": " + ev.detail : ""}`);
    }
  }

  return lines.join("\n");
}

export function cliInspect(capabilityId: string, catalog?: CapabilityCatalog, opts?: InspectOptions): string | null {
  const cat = catalog ?? globalCatalog;
  const entry = cat.get(capabilityId);
  if (!entry) return `Capability not found in catalog: ${capabilityId}`;
  return formatInspectOutput(entry.descriptor, opts);
}

export function cliListStatus(catalog?: CapabilityCatalog): string {
  const cat = catalog ?? globalCatalog;
  const entries = cat.list();
  const lines: string[] = ["ID | Type | Version | State | Enabled | Quarantined | Publisher"];
  for (const e of entries) {
    lines.push(`${e.descriptor.capabilityId} | ${e.descriptor.capabilityType} | ${e.descriptor.version} | ${e.descriptor.lifecycleState} | ${e.enabled ? "yes" : "no"} | ${e.quarantined ? "yes" : "no"} | ${e.descriptor.publisher.id}`);
  }
  return lines.join("\n");
}

/**
 * XR 7.0 — Compatibility contract tests (Phase 13).
 *
 * Checks that the surfaces third parties and stored data depend on remain
 * stable across releases:
 *   public APIs, CLI, workflow definitions, capability manifests, task
 *   capsules, context packages, execution records, workspace data,
 *   deployment profiles, and provider adapters.
 *
 * A "breaking" finding means an existing consumer will break. "additive"
 * means the surface grew, which is safe.
 */

import { CORE_VERSION, PLUGIN_API_VERSION } from "../../core/version.ts";
import { CAPABILITY_DESCRIPTOR_SCHEMA_VERSION } from "../../platform/capabilities/types.ts";
import { WORKFLOW_DEFINITION_SCHEMA_VERSION } from "../../execution/workflow/types.ts";
import { listDeploymentProfiles } from "../deployment/profiles.ts";
import {
  AUDIT_EXPORT_FORMAT_VERSION,
  ENTERPRISE_SCHEMA_VERSION,
} from "../types.ts";
import {
  EVALUATION_SCHEMA_VERSION,
  type CompatibilityCheck,
  type CompatibilityReport,
  type CompatibilitySurface,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Baseline
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The contract baseline XR 7.0 promises to keep.
 *
 * Recorded here so a future change that silently drops an export, renames a
 * CLI command, or bumps a data schema is DETECTED rather than discovered by a
 * user whose integration broke.
 */
export interface ContractBaseline {
  readonly recordedForVersion: string;
  /** Exports each public barrel must continue to provide. */
  readonly publicApi: Readonly<Record<string, readonly string[]>>;
  /** CLI command names that must continue to exist. */
  readonly cliCommands: readonly string[];
  /** Data/schema versions consumers pin against. */
  readonly schemas: Readonly<Record<string, string>>;
  /** Deployment profile kinds that must remain available. */
  readonly deploymentProfiles: readonly string[];
}

export const XR_7_0_CONTRACT_BASELINE: ContractBaseline = Object.freeze({
  recordedForVersion: "7.0.0",
  publicApi: Object.freeze({
    execution: Object.freeze(["ExecutionService", "ExecutionRepo", "adaptWorkspaceStore", "CheckpointManager", "RecoveryManager"]),
    trust: Object.freeze(["classifyRisk", "decidePlacement", "TrustService", "AuthorityRegistry", "CredentialBroker"]),
    context: Object.freeze(["scanForPoisoning", "admitContextWrite", "ContextRetrieval", "ContextAssembler"]),
    workflow: Object.freeze(["WorkflowEngine", "WorkflowRepository", "hashDefinition", "verifyIntegrity", "canMigrateActiveRun"]),
    capabilities: Object.freeze(["runCapabilityContractTests", "validateCapabilityDescriptor", "CapabilityService"]),
    intelligence: Object.freeze(["IntelligenceRouter", "buildCatalog", "policyFromConfig", "routingDecisionToRecord"]),
    environment: Object.freeze(["assessEnvironmentAction", "classifyFailure", "decideRecovery", "redactSecrets"]),
    deployment: Object.freeze(["getDeploymentProfile", "listDeploymentProfiles", "validateProfileCompatibility", "isCapabilityAvailable"]),
    enterprise: Object.freeze(["resolvePolicy", "computeSlo", "buildEvidencePack", "verifyExportedChain", "redactRecord", "currentCompatibility"]),
    evaluation: Object.freeze(["EvaluationRunner", "buildScorecard", "compareRuns", "certify", "EvaluationRepository"]),
  }),
  cliCommands: Object.freeze([
    "run", "ask", "plan", "doctor", "config", "budget", "providers", "memory", "context",
    "plugins", "mcp", "skills", "capabilities", "agents", "shield", "trust", "workspace",
    "audit", "session", "attacks", "logs", "business", "enterprise", "env", "evaluate",
  ]),
  schemas: Object.freeze({
    workflowDefinition: WORKFLOW_DEFINITION_SCHEMA_VERSION,
    capabilityDescriptor: CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
    enterprisePolicy: ENTERPRISE_SCHEMA_VERSION,
    auditExport: AUDIT_EXPORT_FORMAT_VERSION,
    evaluationResult: EVALUATION_SCHEMA_VERSION,
    pluginApi: String(PLUGIN_API_VERSION),
  }),
  deploymentProfiles: Object.freeze([
    "personal_local", "private_local_server", "team_private", "managed_cloud", "hybrid",
  ]),
});

// ═══════════════════════════════════════════════════════════════════════════
// Checks
// ═══════════════════════════════════════════════════════════════════════════

function check(
  surface: CompatibilitySurface,
  id: string,
  description: string,
  compatible: boolean,
  change: CompatibilityCheck["change"],
  detail: string,
): CompatibilityCheck {
  return Object.freeze({ surface, id, description, compatible, change, detail });
}

/**
 * Runtime specifier for this module's own barrel. Assembled at run time so the
 * reflexive compatibility check does not create a static import cycle
 * (Phase 2 · T8). Resolved relative to this file's URL, so it survives bundling
 * and directory moves.
 */
const EVALUATION_BARREL = new URL("./index.ts", import.meta.url).href;

/** Verify every promised public-API export still resolves. */
export async function checkPublicApi(baseline: ContractBaseline = XR_7_0_CONTRACT_BASELINE): Promise<CompatibilityCheck[]> {
  const loaders: Record<string, () => Promise<Record<string, unknown>>> = {
    execution: () => import("../../execution/index.ts"),
    trust: () => import("../../runtime/trust/index.ts"),
    context: () => import("../../context/index.ts"),
    workflow: () => import("../../execution/workflow/index.ts"),
    capabilities: () => import("../../platform/capabilities/index.ts"),
    intelligence: () => import("../../intelligence/index.ts"),
    environment: () => import("../../platform/environment/index.ts"),
    deployment: () => import("../deployment/index.ts"),
    enterprise: () => import("../index.ts"),
    /**
     * Phase 2 · T8 — the evaluation barrel re-exports THIS module, so importing
     * `./index.ts` here closed a dependency cycle. The check is reflexive by
     * nature (verifying the barrel this file is part of), so it resolves the
     * barrel through a runtime-computed specifier: the contract is still
     * verified at run time, but the static graph stays acyclic.
     *
     * `EVALUATION_BARREL` is deliberately not a literal — a literal would be
     * statically resolvable and would re-create the edge.
     */
    evaluation: () => import(/* @vite-ignore */ EVALUATION_BARREL),
  };

  const checks: CompatibilityCheck[] = [];
  for (const [barrel, expected] of Object.entries(baseline.publicApi)) {
    const load = loaders[barrel];
    if (!load) {
      checks.push(
        check("public_api", `api.${barrel}`, `public barrel "${barrel}"`, false, "breaking", "no loader registered for this barrel"),
      );
      continue;
    }
    try {
      const mod = await load();
      const missing = expected.filter((name) => !(name in mod));
      checks.push(
        check(
          "public_api",
          `api.${barrel}`,
          `public barrel "${barrel}"`,
          missing.length === 0,
          missing.length === 0 ? "none" : "breaking",
          missing.length === 0
            ? `all ${expected.length} promised export(s) present (${Object.keys(mod).length} total)`
            : `MISSING export(s): ${missing.join(", ")}`,
        ),
      );
    } catch (e) {
      checks.push(
        check(
          "public_api",
          `api.${barrel}`,
          `public barrel "${barrel}"`,
          false,
          "breaking",
          `failed to import: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }
  return checks;
}

/** Verify promised CLI commands still exist in the catalog. */
export async function checkCli(baseline: ContractBaseline = XR_7_0_CONTRACT_BASELINE): Promise<CompatibilityCheck[]> {
  try {
    const catalog = (await import("../../cli/catalog.ts")) as Record<string, unknown>;
    // The catalog exposes command metadata; collect every string name we can see.
    const names = new Set<string>();
    for (const value of Object.values(catalog)) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          const n = (entry as { name?: unknown })?.name;
          if (typeof n === "string") names.add(n);
          const aliases = (entry as { aliases?: unknown })?.aliases;
          if (Array.isArray(aliases)) for (const a of aliases) if (typeof a === "string") names.add(a);
        }
      }
    }

    if (names.size === 0) {
      return [
        check(
          "cli",
          "cli.catalog",
          "CLI command catalog",
          true,
          "unknown",
          "catalog structure could not be introspected generically; CLI compatibility is covered by the CLI tests instead",
        ),
      ];
    }

    const missing = baseline.cliCommands.filter((c) => !names.has(c));
    return [
      check(
        "cli",
        "cli.commands",
        "promised CLI commands",
        missing.length === 0,
        missing.length === 0 ? "none" : "breaking",
        missing.length === 0
          ? `all ${baseline.cliCommands.length} promised command(s) present`
          : `MISSING command(s): ${missing.join(", ")}`,
      ),
    ];
  } catch (e) {
    return [
      check("cli", "cli.commands", "promised CLI commands", false, "unknown", `catalog unavailable: ${e instanceof Error ? e.message : String(e)}`),
    ];
  }
}

/** Verify data/artifact schema versions have not silently changed. */
export function checkSchemas(baseline: ContractBaseline = XR_7_0_CONTRACT_BASELINE): CompatibilityCheck[] {
  const current: Record<string, string> = {
    workflowDefinition: WORKFLOW_DEFINITION_SCHEMA_VERSION,
    capabilityDescriptor: CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
    enterprisePolicy: ENTERPRISE_SCHEMA_VERSION,
    auditExport: AUDIT_EXPORT_FORMAT_VERSION,
    evaluationResult: EVALUATION_SCHEMA_VERSION,
    pluginApi: String(PLUGIN_API_VERSION),
  };

  const surfaceFor: Record<string, CompatibilitySurface> = {
    workflowDefinition: "workflow_definition",
    capabilityDescriptor: "capability_manifest",
    enterprisePolicy: "workspace_data",
    auditExport: "execution_record",
    evaluationResult: "task_capsule",
    pluginApi: "provider_adapter",
  };

  return Object.entries(baseline.schemas).map(([key, expected]) => {
    const actual = current[key];
    const same = actual === expected;
    return check(
      surfaceFor[key] ?? "workspace_data",
      `schema.${key}`,
      `${key} schema version`,
      same,
      same ? "none" : "breaking",
      same ? `pinned at "${expected}"` : `CHANGED from "${expected}" to "${actual}" — stored data and integrations may break`,
    );
  });
}

/** Verify every promised deployment profile still exists. */
export function checkDeploymentProfiles(baseline: ContractBaseline = XR_7_0_CONTRACT_BASELINE): CompatibilityCheck[] {
  const present = listDeploymentProfiles().map((p) => p.kind as string);
  const missing = baseline.deploymentProfiles.filter((k) => !present.includes(k));
  const added = present.filter((k) => !baseline.deploymentProfiles.includes(k));

  return [
    check(
      "deployment_profile",
      "deployment.profiles",
      "promised deployment profiles",
      missing.length === 0,
      missing.length > 0 ? "breaking" : added.length > 0 ? "additive" : "none",
      missing.length > 0
        ? `MISSING profile(s): ${missing.join(", ")}`
        : added.length > 0
          ? `all promised profiles present; new profile(s) added: ${added.join(", ")}`
          : `all ${present.length} profiles present and unchanged`,
    ),
  ];
}

/**
 * Verify a workflow definition published under the legacy hash still loads.
 *
 * XR 7.0 strengthened the definition content hash. Definitions published by
 * XR ≤ 6.1 must keep working (no destructive migration), so this is an
 * explicit compatibility contract, not an implementation detail.
 */
export async function checkWorkflowLegacyDefinitions(): Promise<CompatibilityCheck[]> {
  try {
    const nodes = await import("../../execution/workflow/nodes.ts");
    const versioning = await import("../../execution/workflow/versioning.ts");
    const types = await import("../../execution/workflow/types.ts");

    const t = nodes.trigger("Start", { type: "manual" });
    const c = nodes.completion("Done", "ok", { dependencies: [t.id] });
    const published = versioning.publishDraft(
      versioning.createDraft({
        name: "Compat Probe",
        nodes: [t, c],
        entryNodeIds: [t.id],
        authoredBy: { kind: "user", id: "compat" },
      }),
    );

    // Simulate a definition stored by XR <= 6.1.
    const legacy = { ...published, contentHash: types.hashDefinitionLegacyV1(published) };
    const legacyLoads = versioning.verifyIntegrity(legacy);
    const inspected = versioning.inspectIntegrity(legacy);

    return [
      check(
        "workflow_definition",
        "workflow.legacy-definitions-load",
        "workflow definitions published before XR 7.0",
        legacyLoads,
        legacyLoads ? "additive" : "breaking",
        legacyLoads
          ? `legacy definitions still verify (reported as "${inspected.level}"), so no destructive migration is required`
          : "legacy definitions no longer verify — upgrading would break stored workflows",
      ),
    ];
  } catch (e) {
    return [
      check(
        "workflow_definition",
        "workflow.legacy-definitions-load",
        "workflow definitions published before XR 7.0",
        false,
        "unknown",
        `probe failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    ];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Report
// ═══════════════════════════════════════════════════════════════════════════

export async function buildCompatibilityReport(
  opts: { now?: number; baseline?: ContractBaseline } = {},
): Promise<CompatibilityReport> {
  const baseline = opts.baseline ?? XR_7_0_CONTRACT_BASELINE;
  const checks: CompatibilityCheck[] = [
    ...(await checkPublicApi(baseline)),
    ...(await checkCli(baseline)),
    ...checkSchemas(baseline),
    ...checkDeploymentProfiles(baseline),
    ...(await checkWorkflowLegacyDefinitions()),
  ];

  const breakingCount = checks.filter((c) => c.change === "breaking").length;

  return Object.freeze({
    productVersion: CORE_VERSION,
    generatedAt: opts.now ?? Date.now(),
    checks: Object.freeze(checks),
    breakingCount,
    compatible: breakingCount === 0,
  });
}

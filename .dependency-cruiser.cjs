/**
 * XR Phase 2 · T8 — the enforced architectural boundary table.
 *
 * Constitution Art. V.2: *"Dependency direction is explicit and acyclic; an
 * architectural test enforces it."* Art. V Acceptance: *"Dependency-cycle test
 * green; each concern has one home; no phase-named modules."*
 *
 * ── This file is the SINGLE SOURCE OF TRUTH for boundary policy ─────────────
 *
 * Both consumers read these rules:
 *   · CI job `boundaries`            — runs depcruise directly
 *   · test/architecture/boundaries.test.ts — reads THIS config, so the rules
 *     are enforced on every `bun test` even without the external binary
 *
 * A second rule set (e.g. an eslint-plugin-boundaries config) would be a second
 * source of truth for one concern, which Cmdt 6 forbids. See ADR-0005.
 *
 * ── The L0–L6 layer map (Constitution §2.2) ─────────────────────────────────
 *
 *   L0 Kernel     src/core, src/state, src/security, src/config, src/util,
 *                 src/cost, src/schemas
 *   L1 Runtime    src/execution (incl. execution/workflow), src/context,
 *                 src/intelligence, src/providers, src/agents, src/control,
 *                 src/runtime/** (trust), src/services, src/reliability
 *   L2 Platform   src/tools, src/plugins, src/skills, src/mcp,
 *                 src/platform/**, src/capabilities/** (Phase 08 unified),
 *                 src/integrations, src/computer,
 *                 src/automation, src/local, src/research, src/repo
 *   L3/L4         plugins + skills are packaged out-of-tree; their HOSTS are L2
 *   L5 Business   @rrrtx/business-os      — EXTRACTED (Phase 5 · ADR-0028)
 *   L6 Enterprise @rrrtx/xr-enterprise    — EXTRACTED (Phase 5 · ADR-0028)
 *                 Both live in satellites/ in a development checkout and are
 *                 absent from a core-only clone. `no-satellite-imports` keeps
 *                 core buildable without them.
 *   Surfaces      src/interfaces, src/cli, src/commands, src/daemon,
 *                 src/telegram, src/voice, src/ui, src/i18n, src/export,
 *                 src/install, src/update
 *
 * **Dependency law:** dependencies point INWARD/DOWNWARD only. A lower layer
 * may never import a higher one. Surfaces may import anything; nothing may
 * import a surface.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── Acyclicity (Art. V.2) ────────────────────────────────────────────────
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependencies are forbidden. XR carried three RUNTIME cycles at " +
        "the start of Phase 2 (the dual-router cycle, control<->computer-use, and " +
        "an evaluation barrel self-import); all three are resolved and must not " +
        "return. Verified with `tsPreCompilationDeps: false`, i.e. over the edges " +
        "that actually exist at run time.",
      from: {},
      to: { circular: true },
    },
    {
      /**
       * Type-only cycles are reported separately, at `warn`.
       *
       * `import type` is ERASED by the compiler, so a loop closed solely by
       * type edges cannot exist at run time and cannot cause a partially-
       * initialised module. XR uses this deliberately and documents it:
       * `src/core/tokens.ts` states *"All service-type imports below are
       * `import type` (erased at compile time) … That keeps tokens.ts at the
       * bottom of the graph, free of import cycles."* Failing the build on
       * those would force a worse design (stringly-typed tokens) to satisfy a
       * tool. They are surfaced, not ignored.
       */
      name: "no-circular-type-only",
      severity: "warn",
      comment:
        "A dependency cycle that exists only through `import type`. Erased at " +
        "compile time, so it is not a runtime cycle — but keep an eye on it.",
      from: {},
      to: { circular: true, dependencyTypes: ["type-only"] },
    },

    // ── L0 Kernel must not depend on anything above it ───────────────────────
    {
      /**
       * L0 Kernel purity.
       *
       * Scope note, verified against the code rather than assumed:
       *
       *  · `src/core/app.ts` + `src/core/providers.ts` ARE the composition root.
       *    Art. VI.1 makes wiring every service their job, so they are exempt —
       *    a composition root that may not name its collaborators cannot exist.
       *  · `src/core/agent.ts` is the agent LOOP. Art. §2.2 places the agent loop
       *    in **L1 Runtime**, not L0; it lives under core/ for historical
       *    reasons and is treated as L1 here. Its own access is constrained by
       *    the `only-runner-imports-agent-loop` rule instead.
       *  · `src/core/execution/*` is the execution envelope — L1 Runtime by the
       *    same table.
       *
       * Everything else under core/state/security/config/util/cost is true L0
       * and must not reach upward.
       */
      name: "kernel-stays-kernel",
      severity: "error",
      comment:
        "L0 Kernel contains only what XR needs to BE XR (Art. VI.2). It must " +
        "not reach into runtime, platform or any surface. " +
        "The composition root (core/app.ts, core/providers/*), the agent loop " +
        "(core/agent.ts) and the execution envelope (core/execution/**) are L1 " +
        "by the boundary table and are scoped out.",
      from: {
        path: "^src/(core|state|security|config|util|cost)/",
        pathNot:
          "^src/core/(app\\.ts|providers\\.ts|providers/|agent\\.ts|execution/)",
      },
      to: {
        path:
          "^src/(execution|context|intelligence|providers|agents|control|runtime|services|reliability|" +
          "tools|plugins|skills|mcp|platform|capabilities|integrations|computer|automation|local|research|repo|" +
          "interfaces|cli|commands|daemon|telegram|voice|ui|i18n|export|install|update)/",
        pathNot:
          /**
           * Three declared, owned exceptions (documented in
           * docs/phase2/BOUNDARIES.md with owner + review date):
           *
           *  1. `providers/presets.ts` — config validates provider ids against
           *     the preset catalogue; the catalogue is data, not runtime logic.
           *  2. `context/repository.ts` — WorkspaceStore owns the schema for
           *     every table including context's, so it creates them at baseline.
           *  3. `interfaces/cli.ts` — shared prompt/colour primitive.
           */
          "^src/(providers/presets\\.ts|context/repository\\.ts|interfaces/cli\\.ts)$",
      },
    },

    // ── L1 Runtime must not depend on L2+ ────────────────────────────────────
    {
      name: "runtime-not-above",
      severity: "error",
      comment:
        "L1 Runtime may use the Kernel, never the Platform, Business, " +
        "Enterprise or a surface (Art. VI.3).",
      from: {
        path: "^src/(execution|context|intelligence|providers|agents|reliability)/",
        pathNot: "^src/execution/adapters/",
      },
      to: {
        path: "^src/(interfaces|cli|commands|daemon|telegram|voice|ui)/",
        pathNot: "^src/interfaces/cli\\.ts$",
      },
    },

    // ── L2 Platform must not depend on a surface ────────────────────
    {
      name: "platform-not-above",
      severity: "error",
      comment: "L2 Platform must not reach into a surface.",
      from: {
        path: "^src/(tools|plugins|skills|mcp|platform|capabilities|integrations|computer|automation)/",
      },
      to: {
        path: "^src/(interfaces|cli|commands|daemon|telegram|voice)/",
        pathNot: "^src/interfaces/cli\\.ts$",
      },
    },

    // ── L5 Business must not depend on L6 ────────────────────────────────────
    {
      name: "business-not-enterprise",
      severity: "error",
      comment:
        "Business OS is an extension package over thin kernel contracts " +
        "(Art. §2.2 L5); it must not depend on enterprise deployment concerns " +
        "or surfaces. The kernel must not import the extension statically.",
      from: { path: "^satellites/business-os/" },
      to: { path: "^src/(interfaces|cli|commands|daemon|telegram|voice|ui|i18n|export|install|update)/" },
    },
    {
      /**
       * Phase 5 · ADR-0028 — supersedes "kernel-no-business-extension".
       *
       * The old rule forbade a static import from the kernel into the in-repo
       * business extension. Phase 5 extracted `src/enterprise` and
       * `extensions/business-os` into satellite packages, so the invariant is
       * now both broader and blunter: NO module under src/ may reference a
       * satellite by any edge. Core must build, test and ship with the
       * satellites/ directory deleted — that is the whole point of the shrink,
       * and it is the property this rule keeps true.
       *
       * If you find yourself wanting to relax this, you are re-coupling core
       * to an optional package; add the contract to src/core/ instead and let
       * the satellite satisfy it structurally (see BusinessOsView in
       * src/core/business-l0.ts for the pattern).
       */
      name: "no-satellite-imports",
      severity: "error",
      comment:
        "Core must not import satellite packages (xr-enterprise, business-os). " +
        "Phase 5 · ADR-0028: core ships without satellites/ present.",
      from: { path: "^src/" },
      to: { path: "^satellites/" },
    },

    // ── Nothing may import a surface ─────────────────────────────────────────
    {
      name: "no-one-imports-surfaces",
      severity: "error",
      comment:
        "Surfaces are leaves. A non-surface module importing a surface inverts " +
        "the dependency direction and is how presentation logic leaks inward.",
      from: {
        pathNot:
          "^src/(interfaces|cli|commands|daemon|telegram|voice|ui|i18n|export|install|update|index\\.ts)",
      },
      to: {
        path: "^src/(interfaces|cli|commands|daemon|telegram|voice|ui)/",
        pathNot: [
          // `interfaces/cli.ts` is the shared prompt/colour primitive
          // (confirm(), colors) used across layers; it is a utility that
          // happens to live in the interfaces folder.
          "^src/interfaces/cli\\.ts$",
          /**
           * `cli/catalog.ts` is the CLI's declarative command CONTRACT (data,
           * not behaviour). Help rendering and the compatibility evidence in
           * the xr-enterprise satellite both read it to prove "every promised
           * command still exists"; inspecting a contract is not the same as
           * depending on presentation logic.
           *
           * Owner: cli · Review: 2.0.0 (Phase 5 re-baseline)
           */
          "^src/cli/catalog\\.ts$",
        ],
      },
    },

    // ── One source of truth per concern (Cmdt 6) ─────────────────────────────
    // Phase 08: src/capabilities was reintroduced as unified capability system
    // (previously retired to platform/capabilities). The old retired path
    // list no longer includes capabilities - it is now L2 Platform.
    {
      name: "no-retired-modules",
      severity: "error",
      comment:
        "These modules were retired in Phase 2. A new import of any of them " +
        "would re-create a duplicate authority.",
      from: {},
      to: {
        path:
          "^src/(memory/|workflow/|providers/routing\\.ts|services/extensibility-bridge\\.ts|" +
          "trust/|deployment/|environment/|evaluation/|baseline/)",
      },
    },

    // ── The execution envelope is the only path to the agent loop (T1) ───────
    {
      name: "only-runner-imports-agent-loop",
      severity: "error",
      comment:
        "src/core/agent.ts is the ACTION phase of the execution envelope, not " +
        "an entry point. Only src/core/execution/runner.ts may import it " +
        "(Art. VI Violations: 'a surface calling runAgent directly').",
      from: { pathNot: "^src/core/(agent\\.ts|execution/runner\\.ts)$" },
      to: { path: "^src/core/agent\\.ts$", dependencyTypesNot: ["type-only"] },
    },

    // ── Hygiene ──────────────────────────────────────────────────────────────
    {
      name: "no-orphans",
      severity: "warn",
      comment: "A module nothing imports is either dead code or a missing wiring.",
      from: {
        orphan: true,
        pathNot: [
          "^src/index\\.ts$",
          "\\.d\\.ts$",
          // Type-only modules have no runtime edges, so with
          // tsPreCompilationDeps:false they appear orphaned by construction.
          "^src/(core/types|agents/types|interfaces/shell/types|skills/marketplace-backend-types)\\.ts$",
          // Reached only through dynamic/CLI dispatch.
          "^src/(automation/cron|cost/estimate|i18n/strings)\\.ts$",
          // Generated typed API client — published for external integrators
          // (Art. XVIII); regenerated and checked by `bun run client:check`.
          // XR itself speaks to the daemon over plain fetch.
          "^src/clients/daemon-client\\.generated\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment: "Production code must not depend on a devDependency.",
      from: { path: "^src/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-deprecated-core",
      severity: "error",
      comment: "Deprecated Node core modules must not be used.",
      from: {},
      to: { dependencyTypes: ["core"], path: "^(punycode|domain|sys|querystring)$" },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["node_modules", "^website/", "\\.test\\.ts$"] },
    tsConfig: { fileName: "tsconfig.json" },
    /**
     * Enforce over the edges that exist AT RUN TIME.
     *
     * With `tsPreCompilationDeps: true` the cruiser also follows `import type`
     * edges, which the TypeScript compiler erases. That reports 35 "cycles" in
     * XR that cannot occur at run time — every one of them closed by a single
     * type-only edge (notably the typed service-token catalogue). Enforcing on
     * erased edges would make the gate lie about what the program does, so the
     * hard `no-circular` rule runs on real edges and the type-only variant is
     * reported as a warning above.
     */
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};

/**
 * Provider: business — Business OS as a GOVERNED EXTENSION (L5), loaded over
 * the thin L0 contract.
 *
 * Constitution Art. XVI / Part Eight:
 *   - the kernel holds only the thin L0 record/artifact/identity/audit
 *     contract (src/core/business-l0.ts);
 *   - the extension package (@rrrtx/business-os) is DEFAULT-EXCLUDED:
 *     it loads only when (a) the operator enables it AND (b) every requested
 *     module passes its effect-verification gate;
 *   - no business domain schema lives in the kernel; no second engine; the
 *     extension runs through the canonical envelope.
 *
 * The extension is imported DYNAMICALLY (lazy) — the kernel never statically
 * depends on business domain code, so the ~11k lines moved out of the kernel
 * cannot regress boot.
 */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { BusinessL0, type BusinessOsExtension } from "../business-l0.ts";

/**
 * Extension entry resolution (Phase 5 · ADR-0028).
 *
 * The extension used to live INSIDE this repo, so the entry point was a fixed
 * relative URL. Phase 5 extracted it to the separately-published
 * `@rrrtx/business-os`, so core can no longer assume a path on disk — it asks
 * the module resolver, and it keeps working when the answer is "not installed".
 *
 * Only the PACKAGE SPECIFIER is resolved — deliberately no relative fallback
 * into a sibling checkout. A path fallback would reintroduce exactly the
 * coupling the extraction removed (and `test/architecture/satellite-isolation`
 * would fail the build for it, correctly). A contributor working on both trees
 * links the package (`bun link @rrrtx/business-os`), which is the same code
 * path a real user takes — so the dev experience exercises the shipping
 * behaviour instead of a special case that only exists in this repo.
 *
 * Failure to resolve is NOT an error: it is the default state of a core-only
 * install, and `loadExtension` records it as an exclusion reason exactly like a
 * disabled config or an unverified module (fail-closed).
 */
const EXTENSION_SPECIFIER = "@rrrtx/business-os";
const EFFECT_VERIFICATION_SPECIFIER = "@rrrtx/business-os/effect-verification";

/** Import an optional package; null when it is not installed. */
async function importOptional<T>(specifier: string): Promise<T | null> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch {
    return null; // not installed — the default state of a core-only install
  }
}

export class BusinessServiceProvider implements ServiceProvider {
  readonly id = "business";
  readonly workspaceScoped = true;

  private instance: BusinessOsExtension | null = null;
  /**
   * Phase 7 · T8 — default-excluded: reason set until the extension loads.
   * The constructor default is display-only; loadExtension re-evaluates the
   * config + effect-verification gates on every call unless a PREVIOUS load
   * attempt produced a definitive exclusion.
   */
  private exclusionReason: string | null = null;
  private loadAttempted = false;

  register(ctx: ProviderContext): void {
    const store = ctx.registry.resolve(Tokens.Store);
    // Phase 7 · T8 — the L0 contract is ALWAYS available (thin kernel
    // surface); the domain extension is default-excluded until proven.
    const l0 = new BusinessL0(store);
    ctx.registry.registerValue(Tokens.BusinessL0, l0, {
      lifecycle: true,
      dependsOn: [Tokens.Store],
      kernelScope: "workspace",
      owner: "business-l0",
    });

    ctx.registry.registerValue(Tokens.Business, null as unknown as BusinessOsExtension, {
      lifecycle: false,
      dependsOn: [Tokens.Store, Tokens.Config],
      kernelScope: "workspace",
      owner: "business-extension",
    });
    this.instance = null;
    this.exclusionReason = this.isBusinessEnabled(ctx) ? null : "Business OS is disabled in config (business.enabled=false) — default-excluded";
    // Lazy loader so surfaces (CLI/daemon) can request the extension on demand.
    const self = this;
    ctx.registry.registerValue(Tokens.BusinessLoader, {
      load: () => self.loadExtension(ctx.registry),
      status: () => self.status(),
    }, {
      lifecycle: false,
      dependsOn: [Tokens.Store, Tokens.Config],
      kernelScope: "workspace",
      owner: "business-loader",
    });
  }

  async init(): Promise<void> {
    const ctx = (this as unknown as { _ctx?: ProviderContext })._ctx;
    void ctx;
    // The extension is loaded lazily on first request (see loadExtension),
    // keeping boot free of business code unless the operator opted in.
  }

  /**
   * Load the governed extension on demand: config-enabled AND every
   * requested module effect-verified, else excluded with a recorded reason.
   */
  async loadExtension(registry: import("../service-registry.ts").ServiceRegistry): Promise<BusinessOsExtension | null> {
    if (this.instance) return this.instance;
    if (this.loadAttempted && this.exclusionReason) return null;
    try {
      const config = registry.resolve(Tokens.Config).get() as { business?: { enabled?: boolean; modules?: string[] } };
      if (!config.business?.enabled) {
        this.loadAttempted = true;
        this.exclusionReason = "Business OS is disabled in config — default-excluded";
        return null;
      }
      // Effect-verification gate: run every requested module's deterministic
      // effect tests against a scratch database. Unproven modules are
      // excluded; if a REQUESTED module is unverified, the whole extension
      // stays excluded (fail-closed) with the reason recorded.
      const ev = await importOptional<{ verifyBusinessOsModules: () => Promise<Array<{ module: string; status: string }>> }>(
        EFFECT_VERIFICATION_SPECIFIER,
      );
      if (!ev) {
        this.loadAttempted = true;
        this.exclusionReason =
          "Business OS is enabled in config but the extension is not installed — install @rrrtx/business-os (Phase 5 · ADR-0028)";
        return null;
      }
      const results = await ev.verifyBusinessOsModules();
      const requested = new Set(config.business.modules ?? results.map((r) => r.module));
      const unverified = results.filter((r) => requested.has(r.module) && r.status !== "verified");
      if (unverified.length > 0) {
        this.loadAttempted = true;
        this.exclusionReason = `Business OS excluded: ${unverified.length} requested module(s) not effect-verified (${unverified.map((u) => u.module).join(", ")})`;
        return null;
      }
      // Verified → load the extension over the L0 contract.
      const mod = await importOptional<{ BusinessOS: new (opts: { db: unknown; l0: BusinessL0 }) => BusinessOsExtension }>(
        EXTENSION_SPECIFIER,
      );
      if (!mod) {
        this.loadAttempted = true;
        this.exclusionReason =
          "Business OS effect-verification passed but the extension entry could not be resolved — install @rrrtx/business-os (Phase 5 · ADR-0028)";
        return null;
      }
      const store = registry.resolve(Tokens.Store);
      const l0 = registry.resolve(Tokens.BusinessL0);
      this.instance = new mod.BusinessOS({ db: store, l0 });
      await this.instance.initialize();
      return this.instance;
    } catch (e) {
      this.loadAttempted = true;
      this.exclusionReason = `Business OS load failed (fail-closed): ${(e as Error).message}`;
      return null;
    }
  }

  /** Public health view: why the extension is or is not active. */
  status(): { loaded: boolean; reason: string | null } {
    return {
      loaded: Boolean(this.instance),
      reason: this.exclusionReason ?? "Business OS is a governed extension — default-excluded until config-enabled and effect-verified",
    };
  }

  private isBusinessEnabled(ctx: ProviderContext): boolean {
    try {
      const config = ctx.registry.resolve(Tokens.Config);
      return config.get().business?.enabled ?? false;
    } catch {
      return false;
    }
  }
}

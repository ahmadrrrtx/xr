/**
 * XR Phase 4 (Evidence Integrity, F-08) — scheduled remote audit anchor job.
 *
 * Kept out of app.ts so the kernel stays within its module-size waiver. The
 * job is OPT-IN (audit.anchor.enabled defaults to false ⇒ zero network calls)
 * and fail-safe: a blocked or failed push is audited/skipped inside
 * pushAnchor and never crashes the background-service loop.
 */
import type { ServiceRegistry } from "./service-registry.ts";
import type { BackgroundServiceManager } from "./services.ts";
import { Tokens } from "./tokens.ts";

const HOURLY = 60 * 60 * 1000;

/** Register the (opt-in) periodic anchor job. */
export function registerAuditAnchorJob(
  registry: ServiceRegistry,
  backgroundServices: BackgroundServiceManager,
): void {
  backgroundServices.registerJob({
    id: "audit_anchor",
    name: "Signed-Audit Remote Anchor (opt-in)",
    intervalMs: HOURLY, // hourly due-check; config intervalMs gates the real push
    owner: "xr.kernel",
    restartOnWorkspaceSwitch: true,
    run: async () => {
      try {
        const store = registry.tryResolve(Tokens.Store);
        if (!store) return; // store not booted in this profile
        const { pushAnchor } = await import("../security/audit-anchor.ts");
        await pushAnchor(store);
      } catch {
        /* anchoring is best-effort and never a runtime dependency */
      }
    },
  });
}

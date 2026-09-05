/**
 * DEPRECATED re-export shim — `src/security/shield.ts`
 *
 * Phase 5 (F-07 · ADR-0027) renamed this module to what it actually is:
 * a host-hygiene SCANNER, not the enforcement boundary. It now lives at
 * `src/hygiene/scanner.ts`.
 *
 *   old: import { XRShieldService } from "src/security/shield.ts";
 *   new: import { SystemHygieneScanner } from "src/hygiene/scanner.ts";
 *
 * The name "XR Shield" now belongs to the ensemble that genuinely enforces —
 * capability policy, the action guard, the trust lattice and its placement
 * decision, consent/approvals, egress control, and signed audit evidence —
 * reachable through the facade at `src/xr-shield/` (ADR-0027).
 *
 * This shim exists so out-of-tree importers do not break at the rename
 * (Art. XXVII: announce → warn → migrate → remove). It re-exports the module
 * verbatim and adds nothing.
 *
 * Removal: 2.0.0. See docs/migration/PHASE-5-SATELLITES.md.
 */

export * from "../hygiene/scanner.ts";

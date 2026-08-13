/**
 * XR Control Center — client application (composed, UX Phase C · C-1).
 *
 * The served client is a single /assets/dashboard.js string. It is authored
 * as cohesive fragments (core / chat / panels / runtime) that are concatenated
 * here — the composition is byte-identical to the pre-split script, so all
 * function hoisting, ordering and globals are preserved exactly. Served bytes
 * are unchanged; the split is purely organizational (per docs/ux/10 and the
 * size-waiver plan).
 */

import { CORE } from "./client-core.ts";
import { CHAT } from "./client-chat.ts";
import { PANELS_A } from "./client-panels-a.ts";
import { PANELS_B } from "./client-panels-b.ts";
import { PANELS_C } from "./client-panels-c.ts";
import { RUNTIME } from "./client-runtime.ts";
export const DASHBOARD_SCRIPT = CORE + CHAT + PANELS_A + PANELS_B + PANELS_C + RUNTIME;

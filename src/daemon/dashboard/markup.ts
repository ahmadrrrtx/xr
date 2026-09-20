/**
 * XR Control Center — page markup (composed, UX Phase C · C-1).
 *
 * The served page is a single HTML string, authored as fragments (head /
 * panels / tail) and concatenated here. Byte-identical to the pre-split
 * document (hash-pinned by test/daemon/dashboard-split.test.ts).
 */

import { PAGE_HEAD } from "./page-head.ts";
import { PAGE_PANELS_A } from "./page-panels-a.ts";
import { PAGE_PANELS_B } from "./page-panels-b.ts";
import { PAGE_TAIL } from "./page-tail.ts";

/**
 * Phase 5 · composition-level banner. The fragments above are hash-pinned by
 * test/daemon/dashboard-split.test.ts, so new chrome lives HERE, in the
 * composition, never inside a pinned fragment.
 *
 *  · headless banner — the dashboard is an OPTIONAL surface; the engine runs
 *    headless and the Desktop/CLI are first-class.
 *  · SEC-09 — EU AI Act Art. 50 disclosure: outputs of this surface are
 *    AI-agent content; the label ships with the surface, not per-message.
 */
const PAGE_BANNER = `
<div role="note" class="xr-banner">
  <span><b class="xr-banner-head">headless-first:</b> the engine runs without this dashboard — Desktop &amp; CLI are the primary surfaces.</span>
  <span><b class="xr-banner-disc">AI disclosure:</b> XR is an AI agent; agent-produced content is AI-generated (EU AI Act Art. 50).</span>
</div>`;

export const DASHBOARD_PAGE = PAGE_HEAD + PAGE_BANNER + PAGE_PANELS_A + PAGE_PANELS_B + PAGE_TAIL;

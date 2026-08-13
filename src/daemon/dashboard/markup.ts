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
export const DASHBOARD_PAGE = PAGE_HEAD + PAGE_PANELS_A + PAGE_PANELS_B + PAGE_TAIL;

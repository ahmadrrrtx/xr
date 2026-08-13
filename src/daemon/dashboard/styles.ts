/**
 * XR Control Center — stylesheet (composed, UX Phase C · C-1).
 *
 * The served CSS is a single /assets/dashboard.css string, authored as
 * fragments (tokens / shell / ui) and concatenated here. Byte-identical to
 * the pre-split sheet; the shared semantic colors still come from
 * src/ui/tokens.ts at build time (single token authority).
 */

import { STYLE_TOKENS } from "./style-tokens.ts";
import { STYLE_SHELL } from "./style-shell.ts";
import { STYLE_UI } from "./style-ui.ts";
export const DASHBOARD_CSS = STYLE_TOKENS + STYLE_SHELL + STYLE_UI;

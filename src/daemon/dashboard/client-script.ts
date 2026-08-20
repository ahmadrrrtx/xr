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
import { STREAM_STATUS_LABEL } from "../../ui/ux-vocabulary.ts";
import { SLASH_COMMANDS } from "../../ui/slash-catalog.ts";

/** Phase 12 — inject the shared vocabulary into the served client (no second source of truth). */
const UX_BOOT =
  "const XR_STATUS = " + JSON.stringify(STREAM_STATUS_LABEL) + ";\n" +
  "const XR_SLASH = " + JSON.stringify(SLASH_COMMANDS) + ";\n" +
  "function xrStatusLabel(s) { return (XR_STATUS && XR_STATUS[s]) || (s ? String(s).replace(/_/g, \" \") : \"Preparing\"); }\n" +
  "function xrSlashHelp() {\n" +
  "  var lines = [\"XR commands (real backends only)\", \"\"];\n" +
  "  XR_SLASH.forEach(function (c) { lines.push(\"/\" + c.name + \" — \" + c.summary); });\n" +
  "  lines.push(\"\", \"Enter send · Shift+Enter newline · Esc interrupt · Ctrl+K palette · Alt+P model\");\n" +
  "  return lines.join(\"\\n\");\n" +
  "}\n";

export const DASHBOARD_SCRIPT = UX_BOOT + CORE + CHAT + PANELS_A + PANELS_B + PANELS_C + RUNTIME;

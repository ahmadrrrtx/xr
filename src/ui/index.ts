/**
 * XR 3.1 — UI subsystem public API
 *
 * Import from here for the full design system + terminal primitives.
 * Safe in CLI, Shell (TUI), and daemon contexts.
 */

// Canonical tokens
export {
  COLOR,
  RGB,
  ANSI16,
  SPACE,
  RADIUS,
  MOTION,
  TYPE,
  SHADOW,
  GRADIENT,
  TERM,
  DENSITY,
  BRAND_META,
  STATUS_COLOR,
  cssVarsBlock,
  CSS_VARS,
  type ColorToken,
  type StatusKind,
} from "./tokens.ts";

// Theme / ANSI (excludes CSS_VARS re-export collision — use tokens)
export {
  BRAND,
  A,
  detectColorMode,
  getColorMode,
  setColorMode,
  setReducedMotion,
  isReducedMotion,
  setTextOnly,
  isTextOnly,
  xrCyan,
  xrViolet,
  xrGreen,
  xrAmber,
  xrRed,
  xrDim,
  xrBold,
  xrMuted,
  xrText,
  xrStatus,
  xrBgTint,
  xrSelected,
  SYM,
  SYM_STATIC,
  SPINNER_FRAMES,
  DOTS_FRAMES,
  BAR_FILLED,
  BAR_EMPTY,
  BAR_HEAD,
  LAYOUT,
  type ColorMode,
} from "./theme.ts";

// Icons / nav vocabulary
export * from "./icons.ts";

// ANSI text utils
export {
  stripAnsi,
  visibleLength,
  padAnsi,
  clipAnsi,
  hline,
  wrapAnsi,
  resetAnsi,
  boxLines,
  centerBlock,
  sliceVisible,
} from "./ansi.ts";

// Terminal engine
export {
  Terminal,
  parseKey,
  type KeyEvent,
  type KeyName,
  type RegionId,
  type FrameBuffer,
} from "./terminal.ts";

// Design primitives (TUI-oriented)
export {
  badge as tuiBadge,
  statusDot,
  button,
  progressBar,
  spinnerFrame,
  divider as tuiDivider,
  emptyState as tuiEmptyState,
  errorState as tuiErrorState,
  successState,
  keyHint,
  keyHintRow,
  listRow,
  sectionHeader,
  navItem,
  toastLine,
  toolCallLine as tuiToolCallLine,
  messagePrefix,
  card,
  composerPrompt,
  statusBar,
  overlayFrame,
  helpBindings,
  type BadgeTone,
  type StatusChip,
} from "./primitives.ts";

// Layout (CLI helpers — console.log based)
export * from "./layout.ts";

// Spinner / progress
export * from "./spinner.ts";

// Brand assets
export {
  OFFICIAL_LOGO_ANSI,
  OFFICIAL_AVATAR_ANSI,
  BRAND_FALLBACK_LOGO,
  renderOfficialBannerFrame,
  renderCompactBrand,
} from "./brand.ts";

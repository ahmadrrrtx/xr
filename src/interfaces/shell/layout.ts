/**
 * XR 3.1 Shell — layout geometry
 * Spec: Design System §4 (TERM constants), §10 (three-pane / single-pane)
 */

import { TERM } from "../../ui/tokens.ts";

export interface LayoutGeom {
  cols: number;
  rows: number;
  headerH: number;
  composerH: number;
  statusH: number;
  bodyH: number;
  sidebarW: number;
  inspectorW: number;
  mainW: number;
  showSidebar: boolean;
  showInspector: boolean;
  iconRail: boolean;
  singlePane: boolean;
}

export function computeLayout(cols: number, rows: number, showInspector: boolean): LayoutGeom {
  const headerH = TERM.HEADER_H;
  const composerH = TERM.COMPOSER_H;
  const statusH = TERM.STATUS_H;
  const bodyH = Math.max(4, rows - headerH - composerH - statusH - 1); // 1 for divider

  const singlePane = cols < TERM.COMFORT_COLS;
  const iconRail = cols < TERM.MIN_COLS + 10;
  const veryNarrow = cols < TERM.MIN_COLS;

  let sidebarW = 0;
  let inspectorW = 0;
  let showSidebar = !veryNarrow;
  let showInsp = showInspector && !singlePane && cols >= TERM.COMFORT_COLS;

  if (veryNarrow) {
    showSidebar = false;
    showInsp = false;
    sidebarW = 0;
    inspectorW = 0;
  } else if (iconRail) {
    sidebarW = TERM.ICON_RAIL_W;
    inspectorW = 0;
    showInsp = false;
  } else if (singlePane) {
    sidebarW = TERM.SIDEBAR_W;
    inspectorW = 0;
    showInsp = false;
  } else {
    sidebarW = TERM.SIDEBAR_W;
    inspectorW = cols >= 140 ? TERM.INSPECTOR_W : TERM.INSPECTOR_W_NARROW;
  }

  // Separators: one │ between each pane
  const seps = (showSidebar ? 1 : 0) + (showInsp ? 1 : 0);
  const mainW = Math.max(20, cols - sidebarW - inspectorW - seps * 3);

  return {
    cols,
    rows,
    headerH,
    composerH,
    statusH,
    bodyH,
    sidebarW,
    inspectorW: showInsp ? inspectorW : 0,
    mainW,
    showSidebar,
    showInspector: showInsp,
    iconRail,
    singlePane,
  };
}

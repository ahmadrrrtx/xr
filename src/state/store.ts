/**
 * XR — DEPRECATED: This file is superseded by workspace-store.ts.
 *
 * All storage now goes through the unified WorkspaceStore singleton.
 * This file is kept only as a re-export for backward compatibility.
 * Import from workspace-store.ts directly instead.
 *
 * See: src/state/workspace-store.ts (0.2 Storage Unification)
 */
export { WorkspaceStore as BaseStore, WorkspaceStore as Store } from "./workspace-store.ts";

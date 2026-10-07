/* Per-file CodeMirror states (undo history, folds, selection) survive tab switches. */
import type { EditorState } from '@codemirror/state';

export const editorStateCache = new Map<string, EditorState>();

/** Drop cached editor state (closed tab / renamed / deleted). */
export function forgetEditorState(path: string): void {
  editorStateCache.delete(path);
}

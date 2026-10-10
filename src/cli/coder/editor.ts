/**
 * Phase 23 — `v` in an approval prompt: open the proposed file body in $VISUAL /
 * $EDITOR (falling back to vi), let the human change it, and return the result.
 *
 * The raw-mode key listener is released for the duration (the editor needs the
 * real terminal) and restored afterwards, even when the editor fails.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { KeyInput } from "./key-input.ts";

/** The editor command line: $VISUAL, then $EDITOR, then vi. */
export function editorCommand(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VISUAL || env.EDITOR || "vi").trim() || "vi";
}

/**
 * Edit `content` (the proposed body of `path`). Returns the edited text, or the
 * original when the editor exits non-zero (a cancelled edit changes nothing).
 */
export async function editInEditor(content: string, path: string, keys: KeyInput | null): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "xr-edit-"));
  const file = join(dir, basename(path) || "proposed.txt");
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
  const cmd = editorCommand();
  keys?.stop();
  try {
    const res = spawnSync("sh", ["-c", `${cmd} "$1"`, "xr-editor", file], { stdio: "inherit" });
    if (res.status !== 0) return content;
    return readFileSync(file, "utf8");
  } finally {
    keys?.start();
    rmSync(dir, { recursive: true, force: true });
  }
}

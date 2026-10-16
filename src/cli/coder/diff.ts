import { style } from "./style.ts";
export { unifiedDiff, diffStats } from "../../util/unified-diff.ts";
export type { DiffStats } from "../../util/unified-diff.ts";

/** Colorize a unified diff: green additions, red removals, cyan hunks. */
export function colorizeDiff(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return style.bold(line);
      if (line.startsWith("@@")) return style.cyan(line);
      if (line.startsWith("+")) return style.green(line);
      if (line.startsWith("-")) return style.red(line);
      return style.dim(line);
    })
    .join("\n");
}

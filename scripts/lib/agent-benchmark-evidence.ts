import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";
import suite from "../../benchmarks/agent/v1/suite.json";
type Snapshot = Record<string, string>;
export function snapshot(root: string): Snapshot {
  const values: Snapshot = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name),
        st = lstatSync(path),
        key = relative(root, path).replaceAll("\\", "/");
      if (st.isSymbolicLink()) values[key] = `link:${readlinkSync(path)}`;
      else if (st.isDirectory()) walk(path);
      else
        values[key] = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
    }
  };
  walk(root);
  return values;
}
export function unauthorizedChanges(
  before: Snapshot,
  after: Snapshot,
  allowed: readonly string[],
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => before[k] !== after[k] && !allowed.includes(k),
  );
}
export function validateSuite(metadata: typeof suite = suite): void {
  if (
    metadata.schemaVersion !== 1 ||
    metadata.tasks.length !== 15 ||
    new Set(metadata.tasks.map((t) => t.id)).size !== 15 ||
    metadata.tasks.filter((t) => t.smoke).length !== 5
  )
    throw new Error(
      "Invalid/changed agent v1 suite; version fixtures before changing coverage",
    );
}

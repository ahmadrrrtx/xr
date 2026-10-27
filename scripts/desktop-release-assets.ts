/** Collect only production installer/updater payload types from workflow
 * artifacts. Prefix architecture to prevent macOS app.tar.gz collisions.
 * Test MSIX/certificates/portable development outputs are never publishable. */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
const SLUGS = new Set([
  "linux-x64",
  "linux-arm64",
  "darwin-arm64",
  "darwin-x64",
  "windows-x64",
  "windows-arm64",
]);
const PAYLOAD =
  /\.(deb|rpm|AppImage|dmg|msi|app\.tar\.gz)(\.sig)?$|-setup\.exe(\.sig)?$/;
export function collectDesktopAssets(input: string, output: string): string[] {
  input = resolve(input);
  output = resolve(output);
  if (input === output || !relative(input, output).startsWith(".."))
    throw new Error("Output must be outside input tree");
  mkdirSync(output, { recursive: true });
  const names: string[] = [];
  const walk = (dir: string) => {
    for (const leaf of readdirSync(dir).sort()) {
      const path = join(dir, leaf),
        st = lstatSync(path);
      if (st.isSymbolicLink())
        throw new Error("Artifact symlinks are not publishable");
      if (st.isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(pfx|p12|pem|key|cer)$|^\.env/.test(leaf))
        throw new Error("Credential/test-certificate artifact refused");
      if (!PAYLOAD.test(leaf)) continue;
      const source = relative(input, path).split(sep)[0]!,
        slug = source.replace(/^xr-(desktop|updater-sigs)-/, "");
      if (!SLUGS.has(slug))
        throw new Error("Artifact missing known architecture provenance");
      const name = `${slug}-${basename(path).replaceAll(" ", ".")}`,
        target = join(output, name);
      if (existsSync(target)) {
        if (
          createHash("sha256").update(readFileSync(target)).digest("hex") !==
          createHash("sha256").update(readFileSync(path)).digest("hex")
        )
          throw new Error("Conflicting same-name installer bytes");
      } else copyFileSync(path, target);
      if (!names.includes(name)) names.push(name);
    }
  };
  walk(input);
  if (!names.some((n) => !n.endsWith(".sig")))
    throw new Error(
      "No production installer payloads; not a successful release",
    );
  for (const n of names)
    if (n.endsWith(".sig") && !names.includes(n.slice(0, -4)))
      throw new Error("Orphan updater signature");
  return names.sort();
}
if (import.meta.main) {
  const a = process.argv.slice(2),
    get = (f: string) => {
      const i = a.indexOf(f);
      return i >= 0 ? a[i + 1] : undefined;
    };
  const input = get("--input"),
    out = get("--out");
  if (!input || !out) throw new Error("--input and --out required");
  console.log(
    JSON.stringify({ files: collectDesktopAssets(input, out) }, null, 2),
  );
}

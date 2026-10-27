/** Real nested mount regression, not a mock or source-string assertion.
 * A private OUTER user/mount namespace creates a writable tmpfs submount in a
 * read-only grant. The shipped INNER wrapper must freeze that inherited mount.
 * Wrapper construction is called directly only to place the trusted outer
 * fixture around it; grant authorization is exercised by the other suites. */
import { afterAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NamespaceSandboxBackend } from "../../src/runtime/trust/environment/namespace";
import { runChild } from "../../src/runtime/trust/environment/backend";
const roots: string[] = [];
afterAll(() => {
  for (const p of roots) rmSync(p, { recursive: true, force: true });
});
const linux = process.platform === "linux" && process.getuid?.() !== 0;
const parentAvailable =
  linux && (await new NamespaceSandboxBackend({ only: "unshare" }).detect());
for (const mechanism of ["unshare", "bwrap"] as const) {
  const backend = new NamespaceSandboxBackend({
    only: mechanism,
    bwrapPath: process.env.XR_TEST_BWRAP_PATH,
  });
  const available = parentAvailable && (await backend.detect()),
    run = available ? test : test.skip;
  run(
    `${mechanism}: inherited writable submount in a read-only grant denies writes; positive workspace write succeeds`,
    async () => {
      const root = mkdtempSync(join(tmpdir(), "xr-inherited-mount-")),
        ws = join(root, "workspace"),
        ro = join(root, "readonly"),
        nested = join(ro, "nested");
      roots.push(root);
      mkdirSync(ws);
      mkdirSync(nested, { recursive: true });
      const canary = join(nested, "canary"),
        control = join(ws, "control"),
        q = (s: string) => JSON.stringify(s);
      const executable = {
        argv: [
          "/bin/sh",
          "-c",
          `if printf changed > ${q(canary)}; then exit 41; fi; printf allowed > ${q(control)}`,
        ],
        cwd: ws,
        env: {},
        timeoutMs: 12_000,
        maxOutputBytes: 8192,
      };
      const construct = backend as any;
      const argv: string[] =
        mechanism === "bwrap"
          ? construct.buildBwrap(executable, [ro], [ws], {}, false)
          : construct.buildUnshare(executable, [ro], [ws], {});
      const setup = `set -eu; mount --make-rprivate /; mount -t tmpfs -o size=1m xr-inherited ${q(nested)}; printf original > ${q(canary)}; chmod 666 ${q(canary)}; "$@"; [ "$(cat ${q(canary)})" = original ]; [ "$(cat ${q(control)})" = allowed ]; printf SUBMOUNT_DENIED`;
      const result = await runChild({
        argv: [
          "unshare",
          "-Urnm",
          "--fork",
          "/bin/sh",
          "-c",
          setup,
          "outer-test-fixture",
          ...argv,
        ],
        cwd: "/",
        env: { PATH: "/usr/bin:/bin" },
        timeoutMs: 15_000,
        maxOutputBytes: 16384,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("SUBMOUNT_DENIED");
      expect(result.stderr).toMatch(/[Rr]ead-only file system/);
      expect(existsSync(control)).toBe(true);
      expect(readFileSync(control, "utf8")).toBe("allowed");
    },
    20_000,
  );
}

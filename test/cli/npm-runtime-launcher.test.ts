/** Node launcher contract for the optional, pinned Bun runtime. */
import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const version = readFileSync(join(root, ".bun-version"), "utf8").trim();
const packageNames = [
  "@oven/bun-darwin-aarch64", "@oven/bun-darwin-x64",
  "@oven/bun-linux-aarch64", "@oven/bun-linux-aarch64-musl",
  "@oven/bun-linux-x64", "@oven/bun-linux-x64-musl",
  "@oven/bun-windows-aarch64", "@oven/bun-windows-x64",
];
const dirs: string[] = [];
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function nodePath(): string {
  const p = spawnSync("node", ["-p", "process.execPath"], { encoding: "utf8" });
  if (p.status !== 0 || !p.stdout.trim()) throw new Error("Node is required to test the npm launcher");
  return p.stdout.trim();
}

function selectedPackage(): string | undefined {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x64" : undefined;
  if (!arch) return undefined;
  if (process.platform === "darwin") return `@oven/bun-darwin-${arch}`;
  if (process.platform === "win32") return `@oven/bun-windows-${arch}`;
  if (process.platform === "linux") {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] } | undefined;
    const loader = arch === "x64" ? "/lib/ld-musl-x86_64.so.1" : "/lib/ld-musl-aarch64.so.1";
    const glibc = !!report?.header?.glibcVersionRuntime;
    const musl = !glibc && ((report?.sharedObjects ?? []).some((p) => /musl/i.test(p)) || existsSync(loader));
    if (!glibc && !musl) return undefined;
    return `@oven/bun-linux-${arch}${musl ? "-musl" : ""}`;
  }
  return undefined;
}

function fixture(nested = false) {
  const base = mkdtempSync(join(tmpdir(), "xr-npm-runtime-"));
  dirs.push(base);
  const project = nested ? join(base, "project") : base;
  const dir = nested ? join(project, "node_modules", "@rrrtx", "xr") : base;
  mkdirSync(join(dir, "bin"), { recursive: true }); mkdirSync(join(dir, "src"));
  copyFileSync(join(root, "bin", "xr"), join(dir, "bin", "xr"));
  // The helper is absent in the pre-fix baseline, so the red test still reaches the old launcher.
  if (existsSync(join(root, "bin", "bun-runtime.js"))) copyFileSync(join(root, "bin", "bun-runtime.js"), join(dir, "bin", "bun-runtime.js"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    type: "module", optionalDependencies: Object.fromEntries(packageNames.map((n) => [n, version])),
  }));
  writeFileSync(join(dir, "src", "index.ts"), "console.log('FIXTURE ENTRY')\n");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "path")) as Record<string, string>;
  delete env.XR_BINARY; delete env.NODE_PATH;
  env.PATH = "";
  return { dir, project, env, run: (extra: string[] = []) => spawnSync(nodePath(), [join(dir, "bin", "xr"), ...extra], { cwd: dir, env, encoding: "utf8" }) };
}

function installFakeRuntime(dir: string, name: string, binaryBody: string, pkgVersion = version): string {
  const pkg = join(dir, "node_modules", ...name.split("/"));
  mkdirSync(join(pkg, "bin"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, version: pkgVersion }));
  const exe = join(pkg, "bin", "bun");
  writeFileSync(exe, `#!/bin/sh\n${binaryBody}\n`, { mode: 0o755 });
  return exe;
}

describe("npm runtime dependency and launcher", () => {
  test("every supported platform runtime is an exact pin matching .bun-version", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { optionalDependencies?: Record<string, string> };
    for (const name of packageNames) expect(pkg.optionalDependencies?.[name]).toBe(version);
  });

  test("platform and libc selection is explicit and never guesses unknown Linux libc", async () => {
    const helperPath = join(root, "bin", "bun-runtime.js");
    const helper = await import(helperPath) as {
      runtimePackage: (platform: string, arch: string, libc: string | null) => string | null;
      linuxLibc: (report: object | null, arch: string, exists: (path: string) => boolean) => string | null;
      compiledBinaryName: (platform: string, arch: string) => string;
    };
    for (const [platform, arch, libc, expected] of [
      ["darwin", "x64", null, "@oven/bun-darwin-x64"],
      ["darwin", "arm64", null, "@oven/bun-darwin-aarch64"],
      ["win32", "x64", null, "@oven/bun-windows-x64"],
      ["win32", "arm64", null, "@oven/bun-windows-aarch64"],
      ["linux", "x64", "glibc", "@oven/bun-linux-x64"],
      ["linux", "x64", "musl", "@oven/bun-linux-x64-musl"],
      ["linux", "arm64", "glibc", "@oven/bun-linux-aarch64"],
      ["linux", "arm64", "musl", "@oven/bun-linux-aarch64-musl"],
      ["linux", "x64", null, null], ["linux", "riscv64", "glibc", null],
      ["freebsd", "x64", null, null],
    ] as Array<[string, string, string | null, string | null]>) {
      expect(helper.runtimePackage(platform, arch, libc)).toBe(expected);
    }
    expect(helper.linuxLibc({ header: { glibcVersionRuntime: "2.36" } }, "x64", () => false)).toBe("glibc");
    expect(helper.linuxLibc({ sharedObjects: ["/lib/ld-musl-aarch64.so.1"] }, "arm64", () => false)).toBe("musl");
    expect(helper.linuxLibc(null, "x64", (p) => p === "/lib/ld-musl-x86_64.so.1")).toBe("musl");
    expect(helper.linuxLibc(null, "x64", () => false)).toBeNull();
    for (const [platform, arch, expected] of [
      ["linux", "x64", "xr-linux-x64"], ["linux", "arm64", "xr-linux-arm64"],
      ["darwin", "x64", "xr-darwin-x64"], ["darwin", "arm64", "xr-darwin-arm64"],
      ["win32", "x64", "xr-windows-x64.exe"], ["win32", "arm64", "xr-windows-arm64.exe"],
      ["freebsd", "arm64", "xr-freebsd-arm64"],
    ]) expect(helper.compiledBinaryName(platform!, arch!)).toBe(expected);
  });

  test("missing runtime and missing system Bun fail with an actionable no-script diagnostic", () => {
    const f = fixture();
    const p = f.run(["--version"]);
    expect(p.status).toBe(127);
    expect(p.stderr).toContain("optional");
    expect(p.stderr).toContain("--omit=optional");
    expect(p.stderr).not.toContain("curl -fsSL");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("a matching bundled runtime wins even when Bun is absent from PATH", () => {
    const f = fixture();
    installFakeRuntime(f.dir, selectedPackage()!, "printf 'BUNDLED_RUNTIME %s\\n' \"$*\"");
    const p = f.run(["--version"]);
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("BUNDLED_RUNTIME run");
    expect(p.stdout).toContain("src/index.ts --version");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("the pinned runtime wins over a Bun executable on PATH", () => {
    const f = fixture();
    installFakeRuntime(f.dir, selectedPackage()!, "echo BUNDLED_RUNTIME");
    const system = join(f.dir, "system"); mkdirSync(system);
    writeFileSync(join(system, "bun"), "#!/bin/sh\necho UNEXPECTED_SYSTEM_RUNTIME\n", { mode: 0o755 });
    f.env.PATH = system;
    const p = f.run();
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("BUNDLED_RUNTIME");
    expect(p.stdout).not.toContain("UNEXPECTED_SYSTEM_RUNTIME");
    expect(p.stderr).not.toContain("using Bun from PATH");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("npm-style hoisted optional dependencies are found", () => {
    const f = fixture(true);
    installFakeRuntime(f.project, selectedPackage()!, "echo HOISTED_RUNTIME");
    const p = f.run();
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("HOISTED_RUNTIME");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("a missing optional runtime preserves the system Bun fallback with a warning", () => {
    const f = fixture();
    const system = join(f.dir, "system"); mkdirSync(system);
    writeFileSync(join(system, "bun"), "#!/bin/sh\necho SYSTEM_RUNTIME\n", { mode: 0o755 });
    f.env.PATH = system;
    const p = f.run();
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("SYSTEM_RUNTIME");
    expect(p.stderr).toContain("using Bun from PATH");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("NODE_PATH cannot inject an unrelated runtime package", () => {
    const f = fixture();
    const external = join(f.dir, "external"); mkdirSync(external);
    installFakeRuntime(external, selectedPackage()!, "echo WRONG_RUNTIME");
    f.env.NODE_PATH = join(external, "node_modules");
    const p = f.run();
    expect(p.status).toBe(127);
    expect(p.stdout).not.toContain("WRONG_RUNTIME");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("an installed runtime at the wrong version fails closed, even if system Bun exists", () => {
    const f = fixture();
    installFakeRuntime(f.dir, selectedPackage()!, "echo BAD_RUNTIME", "9.9.9");
    const system = join(f.dir, "system"); mkdirSync(system);
    writeFileSync(join(system, "bun"), "#!/bin/sh\necho UNEXPECTED_SYSTEM_RUNTIME\n", { mode: 0o755 });
    f.env.PATH = system;
    const p = f.run();
    expect(p.status).not.toBe(0);
    expect(p.stderr).toContain("version");
    expect(p.stdout).not.toContain("UNEXPECTED_SYSTEM_RUNTIME");
    expect(p.stdout).not.toContain("BAD_RUNTIME");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("a missing source entry is diagnosed before invoking the runtime", () => {
    const f = fixture();
    installFakeRuntime(f.dir, selectedPackage()!, "echo UNEXPECTED_RUNTIME");
    rmSync(join(f.dir, "src", "index.ts"));
    const p = f.run();
    expect(p.status).toBe(1);
    expect(p.stderr).toContain("XR entrypoint not found");
    expect(p.stdout).not.toContain("UNEXPECTED_RUNTIME");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("a corrupt installed runtime does not silently use system Bun", () => {
    const f = fixture();
    const exe = installFakeRuntime(f.dir, selectedPackage()!, "echo BAD_RUNTIME");
    rmSync(exe);
    const system = join(f.dir, "system"); mkdirSync(system);
    writeFileSync(join(system, "bun"), "#!/bin/sh\necho UNEXPECTED_SYSTEM_RUNTIME\n", { mode: 0o755 });
    f.env.PATH = system;
    const p = f.run();
    expect(p.status).toBe(1);
    expect(p.stderr).toContain("invalid");
    expect(p.stdout).not.toContain("UNEXPECTED_SYSTEM_RUNTIME");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("a non-executable installed runtime reports an error without falling back", () => {
    const f = fixture();
    const exe = installFakeRuntime(f.dir, selectedPackage()!, "echo BAD_RUNTIME");
    chmodSync(exe, 0o644);
    const system = join(f.dir, "system"); mkdirSync(system);
    writeFileSync(join(system, "bun"), "#!/bin/sh\necho UNEXPECTED_SYSTEM_RUNTIME\n", { mode: 0o755 });
    f.env.PATH = system;
    const p = f.run();
    expect(p.status).toBe(1);
    expect(p.stderr).toContain("could not start");
    expect(p.stdout).not.toContain("UNEXPECTED_SYSTEM_RUNTIME");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("child exits and signals are propagated accurately", () => {
    const f = fixture();
    const exe = installFakeRuntime(f.dir, selectedPackage()!, "exit 7");
    expect(f.run().status).toBe(7);
    writeFileSync(exe, "#!/bin/sh\nkill -INT $$\n", { mode: 0o755 });
    expect(f.run().status).toBe(130);
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("a termination signal sent to the launcher is forwarded to its child", async () => {
    const f = fixture();
    const pidFile = join(f.dir, "child.pid");
    const signalFile = join(f.dir, "child-signal");
    installFakeRuntime(f.dir, selectedPackage()!, `echo $$ > '${pidFile}'\ntrap "echo TERM > '${signalFile}'; exit 143" TERM\nwhile :; do /bin/sleep 0.1; done`);
    const parent = spawn(nodePath(), [join(f.dir, "bin", "xr")], { cwd: f.dir, env: f.env, stdio: "ignore" });
    let childPid = 0;
    try {
      const deadline = Date.now() + 4000;
      while (!existsSync(pidFile) && Date.now() < deadline) await Bun.sleep(20);
      expect(existsSync(pidFile)).toBe(true);
      childPid = Number(readFileSync(pidFile, "utf8").trim());
      parent.kill("SIGTERM");
      while (!existsSync(signalFile) && Date.now() < deadline) await Bun.sleep(20);
      expect(existsSync(signalFile)).toBe(true);
    } finally {
      try { parent.kill("SIGKILL"); } catch { /* already exited */ }
      if (childPid) { try { process.kill(childPid, "SIGKILL"); } catch { /* already exited */ } }
    }
  }, 6000);

  test.skipIf(process.platform === "win32" || !selectedPackage())("non-TTY SIGINT addressed to the launcher is forwarded", async () => {
    const f = fixture();
    const pidFile = join(f.dir, "child-int.pid");
    const signalFile = join(f.dir, "child-int-signal");
    const exe = installFakeRuntime(f.dir, selectedPackage()!, "exit 0");
    writeFileSync(exe, `#!${nodePath()}\nconst fs=require('fs');process.on('SIGINT',()=>{fs.writeFileSync(${JSON.stringify(signalFile)},'INT');process.exit(0)});fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)\n`, { mode: 0o755 });
    const parent = spawn(nodePath(), [join(f.dir, "bin", "xr")], { cwd: f.dir, env: f.env, stdio: "ignore" });
    let childPid = 0;
    try {
      const deadline = Date.now() + 4000;
      while (!existsSync(pidFile) && Date.now() < deadline) await Bun.sleep(20);
      expect(existsSync(pidFile)).toBe(true);
      childPid = Number(readFileSync(pidFile, "utf8").trim());
      parent.kill("SIGINT");
      while (!existsSync(signalFile) && Date.now() < deadline) await Bun.sleep(20);
      expect(existsSync(signalFile)).toBe(true);
    } finally {
      try { parent.kill("SIGKILL"); } catch { /* already exited */ }
      if (childPid) { try { process.kill(childPid, "SIGKILL"); } catch { /* already exited */ } }
    }
  }, 6000);

  test.skipIf(process.platform !== "linux" || !selectedPackage() || !Bun.which("python3"))("one real terminal Ctrl+C reaches the runtime only once", () => {
    const f = fixture();
    const exe = installFakeRuntime(f.dir, selectedPackage()!, "exit 0");
    writeFileSync(exe, `#!${nodePath()}\nlet count=0;process.on('SIGINT',()=>{count++;console.log('SIGINT-COUNT='+count);setTimeout(()=>process.exit(0),250)});console.log('READY');setInterval(()=>{},1000)\n`, { mode: 0o755 });
    const probe = spawnSync(Bun.which("python3")!, [join(root, "test", "cli", "fixtures", "tty-send-ctrl-c.py"), nodePath(), join(f.dir, "bin", "xr")], { encoding: "utf8", timeout: 8000 });
    expect(probe.status).toBe(0);
    const result = JSON.parse(probe.stdout) as { output: string; error: string };
    expect(result.error).toBe("");
    expect(result.output).toContain("SIGINT-COUNT=1");
    expect(result.output).not.toContain("SIGINT-COUNT=2");
  }, 10000);

  test.skipIf(process.platform === "win32" || !selectedPackage())("a missing explicit XR_BINARY does not switch to dist instead of the runtime", () => {
    const f = fixture();
    const names: Record<string, string> = {
      "linux-x64": "xr-linux-x64", "linux-arm64": "xr-linux-arm64",
      "darwin-x64": "xr-darwin-x64", "darwin-arm64": "xr-darwin-arm64",
    };
    mkdirSync(join(f.dir, "dist"));
    writeFileSync(join(f.dir, "dist", names[`${process.platform}-${process.arch}`]!), "#!/bin/sh\necho UNEXPECTED_DIST_BINARY\n", { mode: 0o755 });
    installFakeRuntime(f.dir, selectedPackage()!, "echo BUNDLED_RUNTIME");
    f.env.XR_BINARY = join(f.dir, "missing-override");
    const p = f.run();
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("BUNDLED_RUNTIME");
    expect(p.stdout).not.toContain("UNEXPECTED_DIST_BINARY");
  });

  test.skipIf(process.platform === "win32" || !selectedPackage())("a canonical dist binary still takes precedence over the bundled runtime", () => {
    const f = fixture();
    const names: Record<string, string> = {
      "linux-x64": "xr-linux-x64", "linux-arm64": "xr-linux-arm64",
      "darwin-x64": "xr-darwin-x64", "darwin-arm64": "xr-darwin-arm64",
    };
    mkdirSync(join(f.dir, "dist"));
    writeFileSync(join(f.dir, "dist", names[`${process.platform}-${process.arch}`]!), "#!/bin/sh\necho EXPECTED_DIST_BINARY\n", { mode: 0o755 });
    installFakeRuntime(f.dir, selectedPackage()!, "echo UNEXPECTED_BUNDLED_RUNTIME");
    const p = f.run();
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("EXPECTED_DIST_BINARY");
    expect(p.stdout).not.toContain("UNEXPECTED_BUNDLED_RUNTIME");
  });

  test.skipIf(process.platform === "win32")("the explicit XR_BINARY override still wins", () => {
    const f = fixture();
    const exe = join(f.dir, "explicit-xr");
    writeFileSync(exe, "#!/bin/sh\necho EXPLICIT_XR_BINARY\n", { mode: 0o755 });
    f.env.XR_BINARY = exe;
    const p = f.run(["--version"]);
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("EXPLICIT_XR_BINARY");
  });
});

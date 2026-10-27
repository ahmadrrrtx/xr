import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSums,
  provenanceMatches,
  validateSbom,
  verifyRelease,
} from "../../scripts/verify-release";
import {
  buildSbom,
  lockedCargoDependencies,
  renderCycloneDx,
  sriHash,
} from "../../scripts/sbom";
import {
  signingPlan,
  signingPreflight,
} from "../../scripts/desktop-signing-plan";
import {
  assertDraftOnly,
  requireNativeEvidence,
} from "../../scripts/release-ci-evidence";
import { collectDesktopAssets } from "../../scripts/desktop-release-assets";
const serial = "urn:uuid:d9c81884-d65c-47dd-9332-b4d14064f659";
test("SRI becomes correct hex and graph refs resolve; malformed hashes and fake identity fail", () => {
  const raw = Buffer.alloc(64, 9),
    sri = `sha512-${raw.toString("base64")}`;
  expect(sriHash(sri)).toEqual({
    alg: "SHA-512",
    content: raw.toString("hex"),
  });
  expect(() => sriHash("sha512-not-a-real-hash")).toThrow();
  const doc = renderCycloneDx({
    componentName: "xr",
    componentVersion: "1.2.3",
    serialNumber: serial,
    dependencies: [{ name: "one", version: "1.0.0", integrity: sri }],
  });
  expect(validateSbom(doc, "1.2.3")).toBe(true);
  expect(validateSbom(doc, "9.9.9")).toBe(false);
  const corrupt = structuredClone(doc) as any;
  corrupt.components[0].hashes[0].content = raw.toString("base64");
  expect(validateSbom(corrupt)).toBe(false);
  corrupt.components[0].hashes[0].content = raw.toString("hex");
  corrupt.dependencies[0].dependsOn = ["absent"];
  expect(validateSbom(corrupt)).toBe(false);
});
test("combined inventory contains real renderer and Cargo locked dependencies; no version override", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-candidate-inventory-"));
  try {
    const out = join(dir, "sbom.json");
    buildSbom({ out, scope: "combined" });
    const doc = JSON.parse(readFileSync(out, "utf8"));
    expect(validateSbom(doc)).toBe(true);
    expect(
      doc.components.some((c: any) => c["bom-ref"].startsWith("cargo:")),
    ).toBe(true);
    expect(doc.components.some((c: any) => c.name === "react")).toBe(true);
    expect(lockedCargoDependencies().length).toBeGreaterThan(100);
    expect(() => buildSbom({ out, version: "0.0.0-false" })).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("malformed/duplicate/path-escape checksum inventories fail closed", () => {
  const h = "ab".repeat(32);
  expect(parseSums(`${h}  a.tgz\n`).get("a.tgz")).toBe(h);
  for (const text of [
    "",
    `oops a`,
    `\n${h} ../private`,
    `${h} /private`,
    `${h} C:\\private`,
    `${h} ./a\n${h} a`,
    `${h} x/../a`,
  ])
    expect(() => parseSums(text)).toThrow();
});
test("DSSE subject matching is name+digest only, never authentication", () => {
  const digest = "aa".repeat(32),
    statement = { subject: [{ name: "xr.tgz", digest: { sha256: digest } }] };
  const dsse = JSON.stringify({
    payloadType: "application/vnd.in-toto+json",
    payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
    signatures: [],
  });
  expect(provenanceMatches(dsse, "xr.tgz", digest)).toBe(true);
  expect(provenanceMatches(dsse, "other.tgz", digest)).toBe(false);
  expect(provenanceMatches(dsse, "xr.tgz", "bb".repeat(32))).toBe(false);
});
test("valid local crypto cannot hide requested missing files or substitute for strict release evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-candidate-verify-"));
  try {
    const artifact = join(dir, "xr.tgz"),
      key = join(dir, "pub"),
      sig = join(dir, "sig");
    writeFileSync(artifact, "actual fixture bytes");
    const pair = generateKeyPairSync("ed25519");
    writeFileSync(key, pair.publicKey.export({ format: "pem", type: "spki" }));
    writeFileSync(sig, sign(null, readFileSync(artifact), pair.privateKey));
    const missing = join(dir, "missing"),
      report = await verifyRelease({
        artifact,
        localKey: key,
        localSig: sig,
        sums: missing,
        sbom: missing,
        provenance: missing,
      });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "local-signature")?.ok).toBe(
      true,
    );
    for (const name of [
      "artifact-sha256",
      "sbom-cyclonedx",
      "slsa-provenance-subject",
    ])
      expect(report.checks.find((c) => c.name === name)?.ok).toBe(false);
    expect(
      (
        await verifyRelease({
          artifact,
          localKey: key,
          localSig: sig,
          strict: true,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await verifyRelease({
          artifact,
          localKey: key,
          localSig: sig,
          cosignIdentity: "https://github.com/owner/repo/*",
        })
      ).ok,
    ).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("all tag candidates require actual OS-signing prerequisites, not just a preview label", () => {
  const base = {
    tag: true,
    pubkeyCommitted: false,
    hasUpdaterKey: false,
    hasAppleCert: false,
    hasAppleNotary: false,
    hasWindowsCert: false,
  };
  expect(signingPreflight(base).length).toBe(3);
  for (const os of ["windows", "macos"] as const)
    expect(signingPlan({ ...base, os }).error).toBeDefined();
  expect(signingPreflight({ ...base, tag: false })).toEqual([]);
});
test("release preparation never replaces a published release", async () => {
  await expect(
    assertDraftOnly(async () => ({ draft: false }), "v1.2.3"),
  ).rejects.toThrow();
  await assertDraftOnly(async () => null, "v1.2.3");
  await assertDraftOnly(async () => ({ draft: true }), "v1.2.3");
});
test("native evidence must be successful exact-tag/exact-SHA latest run and a real completed aggregate job", async () => {
  const sha = "a".repeat(40),
    tag = "v1.2.3-rc.1",
    row = {
      id: 42,
      run_number: 42,
      run_attempt: 1,
      path: ".github/workflows/desktop-app.yml",
      head_sha: sha,
      head_branch: tag,
      event: "push",
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/owner/repo/actions/runs/42",
    };
  const job = {
    name: "Desktop gate (bundles + latest.json + journey)",
    status: "completed",
    conclusion: "success",
  };
  const api =
    (runs: any[], jobs: any[] = [job]) =>
    async (path: string) =>
      path.includes("/jobs?") ? { jobs } : { workflow_runs: runs };
  expect((await requireNativeEvidence(api([row]), sha, tag)).runId).toBe(42);
  for (const patch of [
    { head_sha: "b".repeat(40) },
    { head_branch: "main" },
    { event: "pull_request" },
    { conclusion: "failure" },
    { status: "in_progress" },
  ])
    await expect(
      requireNativeEvidence(api([{ ...row, ...patch }]), sha, tag),
    ).rejects.toThrow();
  await expect(
    requireNativeEvidence(api([row], []), sha, tag),
  ).rejects.toThrow();
  await expect(
    requireNativeEvidence(
      api([row, { ...row, id: 43, run_number: 43, conclusion: "failure" }]),
      sha,
      tag,
    ),
  ).rejects.toThrow();
});
test("desktop architecture collisions are prevented and test/private artifacts cannot publish", () => {
  const root = mkdtempSync(join(tmpdir(), "xr-desktop-assets-")),
    input = join(root, "in"),
    out = join(root, "out");
  try {
    for (const slug of ["darwin-arm64", "darwin-x64"]) {
      const dir = join(input, `xr-desktop-${slug}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "XR.app.tar.gz"), slug);
    }
    expect(collectDesktopAssets(input, out)).toEqual([
      "darwin-arm64-XR.app.tar.gz",
      "darwin-x64-XR.app.tar.gz",
    ]);
    const dir = join(input, "xr-desktop-windows-x64");
    mkdirSync(dir);
    writeFileSync(join(dir, "development.msix"), "test-only");
    expect(
      collectDesktopAssets(input, out).some((n) => n.endsWith(".msix")),
    ).toBe(false);
    writeFileSync(join(dir, "private.pfx"), "not a real key");
    expect(() => collectDesktopAssets(input, out)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workflow graph prepares only private drafts and requires owner + exact native CI before publication", () => {
  const { jobs: r } = Bun.YAML.parse(
    readFileSync(
      join(import.meta.dir, "../../.github/workflows/release.yml"),
      "utf8",
    ),
  ) as any;
  const { jobs: d } = Bun.YAML.parse(
    readFileSync(
      join(import.meta.dir, "../../.github/workflows/desktop-app.yml"),
      "utf8",
    ),
  ) as any;
  // Validate the real graph, not a successful source substring.
  const visit = (jobs: any) => {
    const active = new Set<string>(),
      done = new Set<string>();
    const walk = (n: string) => {
      if (active.has(n)) throw new Error("workflow cycle");
      if (done.has(n)) return;
      if (!jobs[n]) throw new Error("missing dependency");
      active.add(n);
      for (const dep of jobs[n].needs ?? []) walk(dep);
      active.delete(n);
      done.add(n);
    };
    for (const n of Object.keys(jobs)) walk(n);
  };
  visit(r);
  visit(d);
  const draft = r.release.steps.find((s: any) =>
    s.uses?.startsWith("softprops/action-gh-release@"),
  );
  expect(draft.with.draft).toBe(true);
  expect(draft.with.make_latest).toBe(false);
  expect(r.provenance.with["upload-assets"]).toBe(false);
  expect(r["verify-release"].needs).toContain("provenance");
  for (const n of ["publish-npm", "publish-docker", "promote"]) {
    expect(r[n].if).toContain("workflow_dispatch");
    expect(r[n].if).toContain("inputs.publish");
  }
  expect(r.promote.needs).toContain("native-evidence");
  expect(r["publish-npm"].needs).toContain("promote");
  expect(
    r["publish-npm"].steps.map((s: any) => s.run ?? "").join("\n"),
  ).not.toMatch(/--tag latest/);
  expect(
    r["publish-docker"].steps.find((s: any) => s.id === "meta").with.tags,
  ).not.toContain("value=latest");
  for (const st of d["draft-assets"].steps.filter((s: any) =>
    s.uses?.startsWith("softprops/action-gh-release@"),
  )) {
    expect(st.with.draft).toBe(true);
    expect(st.if).toContain("github.ref_type == 'tag'");
  }
  expect(d["desktop-gate"].needs).toContain("draft-assets");
  expect(d["draft-assets"].needs).toContain("desktop-validation");
  expect(
    d["shell-check"].steps.find((s: any) => s.with?.toolchain).with.toolchain,
  ).toBe(
    readFileSync(join(import.meta.dir, "../../.rust-version"), "utf8").trim(),
  );
});

test("channel file bytes must be in the signed inventory; matching URLs do not forgive injected Ruby", async () => {
  const { verifyChannelFiles, wingetFileNames } =
    await import("../../scripts/channel-publish-verify");
  const files: Record<string, string> = {
    "xr.rb": 'version "1.2.3"\n',
    "xr.json": '{"version":"1.2.3","architecture":{}}',
  };
  for (const name of wingetFileNames("Xr.Xr"))
    files[name] = "PackageIdentifier: Xr.Xr\nPackageVersion: 1.2.3\n";
  const sums = new Map(
    Object.entries(files).map(([n, s]) => [
      n,
      createHash("sha256").update(s).digest("hex"),
    ]),
  );
  const input = {
    version: "1.2.3",
    packageId: "Xr.Xr",
    repoSlug: "owner/repo",
    sums,
    files,
    requireSignedFiles: true,
  };
  expect(
    verifyChannelFiles(input).filter((p) => p.includes("not authenticated")),
  ).toHaveLength(0);
  files["xr.rb"] += 'system "not allowed even when version/URLs match"\n';
  expect(
    verifyChannelFiles(input).some((p) =>
      p.includes("xr.rb: bytes are not authenticated"),
    ),
  ).toBe(true);
});

test("raw OS/updater signing credentials are tag-only env inputs, never PR/development values", () => {
  const workflow = Bun.YAML.parse(
    readFileSync(
      join(import.meta.dir, "../../.github/workflows/desktop-app.yml"),
      "utf8",
    ),
  ) as any;
  const keys = new Set([
    "WINDOWS_CERTIFICATE",
    "WINDOWS_CERTIFICATE_PASSWORD",
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  ]);
  let found = 0;
  for (const step of workflow.jobs.bundle.steps)
    for (const [key, value] of Object.entries(step.env ?? {}))
      if (keys.has(key)) {
        found++;
        expect(String(value)).toContain("github.ref_type == 'tag'");
      }
  expect(found).toBe(10);
});

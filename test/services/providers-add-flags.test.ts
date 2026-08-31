/**
 * XR — unit: `providers add` non-interactive flag parser + validators
 * (Phase 0, M-05 / XR003).
 *
 * The parser is pure and exported so the unattended-mode contract is unit-
 * testable without spawning a CLI: flags in any order, values with spaces,
 * repeatable --header, `-y` alias, missing values surfaced (never guessed),
 * and validation that is strictly at least as strict as the interactive path.
 */

import { describe, expect, test } from "bun:test";
import {
  parseAddProviderFlags,
  validateProviderId,
  validateBaseUrl,
} from "../../src/commands/providers.ts";

describe("parseAddProviderFlags", () => {
  test("parses every flag in any order", () => {
    const f = parseAddProviderFlags([
      "--base-url",
      "http://127.0.0.1:9/v1",
      "--label",
      "My Stub",
      "--model",
      "stub-model",
      "--id",
      "my-stub",
      "--yes",
    ]);
    expect(f.yes).toBe(true);
    expect(f.id).toBe("my-stub");
    expect(f.label).toBe("My Stub");
    expect(f.baseUrl).toBe("http://127.0.0.1:9/v1");
    expect(f.model).toBe("stub-model");
    expect(f.unknown).toEqual([]);
  });

  test("supports the -y alias", () => {
    expect(parseAddProviderFlags(["-y"]).yes).toBe(true);
  });

  test("repeatable --header collects name/value pairs", () => {
    const f = parseAddProviderFlags([
      "--header",
      "X-One: 1",
      "--header",
      "Authorization: Bearer xyz",
    ]);
    expect(f.headers).toEqual([
      { name: "X-One", value: "1" },
      { name: "Authorization", value: "Bearer xyz" },
    ]);
  });

  test("positional id (interactive legacy) still parsed", () => {
    const f = parseAddProviderFlags(["legacy-id"]);
    expect(f.positionalId).toBe("legacy-id");
    expect(f.yes).toBe(false);
  });

  test("a malformed --header is surfaced as unknown, not silently mangled", () => {
    const f = parseAddProviderFlags(["--header", "no-colon-here"]);
    expect(f.headers).toEqual([]);
    expect(f.unknown.length).toBeGreaterThan(0);
  });

  test("missing flag values surface as unknown (never a prompt, never a guess)", () => {
    const f = parseAddProviderFlags(["--id"]);
    expect(f.id).toBeUndefined();
    const g = parseAddProviderFlags(["--model", "--yes"]);
    expect(g.model).toBeUndefined();
  });

  test("router-reinjected global flags are tolerated anywhere and never leak into positionals", () => {
    const f = parseAddProviderFlags([
      "--no-color", "--id", "x", "--json",
      "--workspace", "/some/path",
      "--provider", "ollama",
      "--base-url", "http://h/v1",
      "--model", "m", "--yes", "--quiet",
    ]);
    expect(f.id).toBe("x");
    expect(f.baseUrl).toBe("http://h/v1");
    expect(f.model).toBe("m");
    expect(f.yes).toBe(true);
    expect(f.positionalId).toBeUndefined();
    expect(f.unknown).toEqual([]);
  });
});

describe("validateProviderId / validateBaseUrl", () => {
  test("id rules: lowercase letters, digits, dash, underscore", () => {
    expect(validateProviderId("my-stub_2")).toBeNull();
    expect(validateProviderId("MyStub")).toBeNull(); // zod accepts /i — keep parity
    expect(validateProviderId("my stub")).not.toBeNull();
    expect(validateProviderId("")).not.toBeNull();
    expect(validateProviderId("stub!")).not.toBeNull();
  });

  test("base URL rules: parseable http(s), no embedded credentials", () => {
    expect(validateBaseUrl("http://localhost:8080/v1")).toBeNull();
    expect(validateBaseUrl("https://api.example.com/v1")).toBeNull();
    expect(validateBaseUrl("not a url")).not.toBeNull();
    expect(validateBaseUrl("ftp://example.com")).not.toBeNull();
    expect(validateBaseUrl("http://user:pass@example.com/v1")).not.toBeNull();
  });
});

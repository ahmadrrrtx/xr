/** XR 5.1 — Environment privacy unit tests (redaction, consent, retention). */
import { describe, test, expect } from "bun:test";
import {
  redactSecrets,
  redactEnvironmentAction,
  checkCloudConsent,
  screenshotRetention,
  transcriptRetention,
} from "../../src/environment/privacy.ts";

describe("redactSecrets", () => {
  test("redacts API keys and tokens in free text", () => {
    const out = redactSecrets("use key sk-abcdef0123456789xyz for the API");
    expect(out).not.toContain("sk-abcdef0123456789xyz");
    expect(out).toContain("«redacted»");
  });

  test("redacts password=/token= assignments", () => {
    const out = redactSecrets("password=hunter2 token: abcdef123456");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("abcdef123456");
  });

  test("redacts JWT-shaped strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactSecrets(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
  });

  test("redacts GitHub personal access tokens", () => {
    const out = redactSecrets("use ghp_0123456789abcdefghijABCDEF for push");
    expect(out).not.toContain("ghp_0123456789abcdefghijABCDEF");
  });

  test("redacts cookie assignments", () => {
    const out = redactSecrets("Cookie: sessionid=abc123def456ghi789; csrftoken=zz987zyx654wvu321");
    expect(out).not.toContain("abc123def456ghi789");
    expect(out).not.toContain("zz987zyx654wvu321");
  });

  test("redacts private key blocks wholesale", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEXV\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(`here:\n${key}`)).not.toContain("MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEXV");
  });

  test("leaves ordinary text untouched", () => {
    const text = "navigate to https://example.com and extract the pricing table";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("redactEnvironmentAction", () => {
  test("strips sensitive typed values but preserves length metadata", () => {
    const out = redactEnvironmentAction({ type: "type", text: "supersecret", sensitive: true });
    expect(out.text).toBe("«redacted»");
    expect(out.textLength).toBe(11);
  });

  test("strips sensitive browser fill values", () => {
    const out = redactEnvironmentAction({
      type: "browser",
      op: "fill",
      selector: "input[name=password]",
      value: "hunter2",
      sensitive: true,
    });
    expect(out.value).toBe("«redacted»");
    expect(out.valueLength).toBe(7);
    expect(out.selector).toContain("password"); // selector is structure, not secret
  });

  test("scans free-text url fields for leaked credentials", () => {
    const out = redactEnvironmentAction({
      type: "open",
      target: "https://user:password=hunter2@example.com",
    });
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  test("non-sensitive actions stay intact", () => {
    const out = redactEnvironmentAction({ type: "browser", op: "extract", selector: "h1" });
    expect(out.selector).toBe("h1");
  });
});

describe("checkCloudConsent", () => {
  test("no ambient consent: settings off → blocked even if session allows", () => {
    const d = checkCloudConsent("vision", false, true);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("not enabled in settings");
  });

  test("session policy cannot raise above settings", () => {
    const d = checkCloudConsent("vision", true, false);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("session's environment policy");
  });

  test("explicit dual consent allows cloud", () => {
    expect(checkCloudConsent("vision", true, true).allowed).toBe(true);
  });

  test("stt/tts kinds get voice-specific remediation hints", () => {
    expect(checkCloudConsent("stt", false, true).reason).toContain("xr voice setup");
  });
});

describe("retention decisions", () => {
  test("raw screenshots are never retained by the record layer", () => {
    const d = screenshotRetention();
    expect(d.retainRaw).toBe(false);
    expect(d.reason).toContain("path+hash");
  });

  test("transcripts persist only under local-private at 0600", () => {
    expect(transcriptRetention("off").retainRaw).toBe(false);
    expect(transcriptRetention("session").retainRaw).toBe(false);
    const lp = transcriptRetention("local-private");
    expect(lp.retainRaw).toBe(true);
    expect(lp.reason).toContain("0600");
  });
});

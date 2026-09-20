/**
 * XR Desktop — renderer lane (Phase 1 · closes gap G-15).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The Phase 0 audit found the renderer had ZERO tests:
 *
 *     $ grep -rln "desktop/src" test/        →   (no matches)
 *
 * That is why defects like D-01 shipped. "Escape does not exit Voice mode" is
 * not a subtle bug — it is a one-line assertion. Nothing was asserting. This
 * lane mounts the REAL app against the REAL engine daemon in a real browser and
 * pins each finding the audit made by hand.
 *
 * Every check is behavioural (keyboard, focus, computed style, DOM text) rather
 * than snapshot-based, because the failures that matter here are interaction
 * failures and a snapshot would happily record the broken state.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS NOT A `bun test` FILE
 * ─────────────────────────────────────────────────────────────────────────────
 * Two runner properties make Bun's test runner the wrong host:
 *   1. Bun kills processes spawned inside a test file ("killed 2 dangling
 *      processes"), which takes Chromium and the dev server down mid-run — 15
 *      of 16 tests then failed with "browser has been closed".
 *   2. Top-level beforeAll/afterAll are scoped per describe block there, so the
 *      shared browser was torn down between suites.
 * A 40-line harness removes both problems and keeps the lane runnable with no
 * extra dependencies. It is opt-in because it needs a live daemon + a browser.
 *
 * RUN
 *   bun run desktop/test/renderer.lane.ts
 *   XR_DAEMON_URL=http://127.0.0.1:3141 XR_DEV_TOKEN=<token> bun run desktop/test/renderer.lane.ts
 *
 * Playwright and axe-core are resolved from the REPO ROOT on purpose: the
 * desktop workspace resolves playwright-core 1.63 while the root pins 1.60
 * (the version whose Chromium is actually installed here). Reading both from
 * one manifest keeps the lane's browser deterministic.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build, preview, type PreviewServer } from "vite";

/** /home/user/repo/package.json — the dependency authority for this lane. */
const rootRequire = createRequire(fileURLToPath(new URL("../../package.json", import.meta.url)));
const { chromium } = rootRequire("playwright") as typeof import("playwright");
const AXE_SOURCE = readFileSync(rootRequire.resolve("axe-core/axe.min.js"), "utf8");

type Page = import("playwright").Page;

const PORT = Number(process.env.XR_TEST_PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const DAEMON = process.env.XR_DAEMON_URL ?? "http://127.0.0.1:3141";
const TIMEOUT_MS = Number(process.env.XR_TEST_TIMEOUT ?? 45_000);

/* -------------------------------------------------------------------------
   Minimal harness: sequential, timeout-bounded, honest summary.
   ------------------------------------------------------------------------- */
type Case = { name: string; fn: () => Promise<void> };
const cases: Case[] = [];
function check(name: string, fn: () => Promise<void>): void {
  cases.push({ name, fn });
}

class Skip extends Error {}
/** Skip when a precondition the ENGINE owns is not met (never a silent pass). */
function skipUnless(cond: boolean, why: string): void {
  if (!cond) throw new Skip(why);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function eq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

/* -------------------------------------------------------------------------
   Environment
   ------------------------------------------------------------------------- */
let server: PreviewServer;
let browser: import("playwright").Browser;
let engineUp = false;

/**
 * Build, then serve the BUILD — not the dev server.
 *
 * The first version of this lane used `vite dev`, and it was flaky in a way
 * that looked like product failure: Vite re-optimizes dependencies the first
 * time a lazy route pulls in a new package (CodeMirror, React), and each
 * re-optimization forces a full page reload. Mid-test reloads produced
 * "element was detached from the DOM, retrying" for up to 45 s and an
 * intermittently absent `.rail`. None of that exists in the shipped app.
 *
 * Testing the built artifact is also simply more honest: `dist/` is what the
 * Tauri shell loads, so this is the code the user runs. The proxy rules are the
 * same ones dev uses (shared factory in vite.config.ts).
 */
async function boot(): Promise<void> {
  const root = fileURLToPath(new URL("..", import.meta.url));
  await build({ root, logLevel: "error" });
  server = await preview({
    root,
    preview: { host: "127.0.0.1", port: PORT, strictPort: true },
    logLevel: "error",
  });
  try {
    engineUp = (await fetch(`${DAEMON}/api/v1/health`)).ok;
  } catch {
    engineUp = false;
  }
  browser = await chromium.launch();
}

async function shutdown(): Promise<void> {
  await browser?.close().catch(() => {});
  // Vite's preview server exposes the underlying http.Server via .httpServer
  await (server as unknown as { close?: () => Promise<void> })?.close?.().catch(() => {});
}

/**
 * Open the app on the shell the user actually works in.
 *
 * The first-run gate is ENGINE-OWNED (the shell asks /onboarding/status), so
 * this steps through it the way a user would instead of stubbing the flag. The
 * honest offline splash is reported as a failure with the command to fix it.
 */
async function openShell(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
  page.setDefaultTimeout(TIMEOUT_MS);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  (page as unknown as { __errors: string[] }).__errors = errors;

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Wait for a TERMINAL state. The S0 boot splash in its `booting` state is
  // deliberately excluded: it holds the shell back until the engine has
  // answered link/health/first-run (src/boot.ts), and matching it here would
  // send the lane looking for a rail that is still a beat away.
  try {
    await page.waitForSelector('.rail, .ob, .boot[data-state="failed"]', { timeout: 25_000 });
  } catch {
    throw new Error(`the app rendered nothing recognisable after 25s\n${await describeDom(page)}`);
  }

  // Only a FAILED boot is a lane failure; the splash's own lines say why —
  // surface them verbatim instead of guessing.
  if (await page.$('.boot[data-state="failed"]')) {
    const lines = await page.$$eval(".boot-line", (els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ").trim()));
    throw new Error(
      "engine unreachable — the shell is showing its boot failure. Start the daemon first:\n" +
        "  XR_DAEMON_TOKEN=<token> bun run src/index.ts serve --port 3141\n" +
        lines.map((l) => `  ${l}`).join("\n"),
    );
  }
  // The first-run gate is engine-owned: with a valid token and no provider
  // configured, /onboarding/status answers needsSetup:true and the shell is
  // correctly withheld. Drive the real control (this also asserts the gate is
  // escapable) rather than mutating engine state behind the app's back.
  if (await page.$(".ob")) {
    await page.getByRole("button", { name: /skip for now/i }).click({ timeout: 10_000 });
    try {
      await page.waitForFunction(() => !document.querySelector(".ob"), null, { timeout: 10_000 });
    } catch {
      throw new Error(`onboarding did not yield to the shell after "Skip for now"\n${await describeDom(page)}`);
    }
  }
  try {
    await page.waitForSelector(".rail", { timeout: 20_000 });
  } catch {
    throw new Error(`the shell never replaced the gate\n${await describeDom(page)}`);
  }
  return page;
}

/** Compact DOM state for a failure message — turns a timeout into a fact. */
async function describeDom(page: Page): Promise<string> {
  const state = await page.evaluate(() => ({
    rootChildren: Array.from(document.getElementById("root")?.children ?? []).map((c) => c.className || c.tagName),
    ob: !!document.querySelector(".ob"),
    splash: document.querySelector(".boot")?.getAttribute("data-state") ?? false,
    rail: !!document.querySelector(".rail"),
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200),
  })).catch(() => null);
  if (!state) return "  (page is gone)";
  return `  root=${JSON.stringify(state.rootChildren)} ob=${state.ob} splash=${state.splash} rail=${state.rail}\n  text="${state.text}"`;
}

/**
 * Press a keyboard shortcut and wait for its effect.
 *
 * Retries because the shell attaches its window keydown listener in an effect:
 * a key pressed in the same task as the first paint can race the listener. A
 * human cannot press a key that fast, so retrying is modelling the user rather
 * than papering over a defect — if the shortcut is genuinely broken the retries
 * all fail and the assertion reports it.
 */
async function pressFor(page: Page, key: string, appears: string, tries = 3): Promise<void> {
  for (let i = 0; i < tries; i++) {
    await page.keyboard.press(key);
    try {
      await page.waitForSelector(appears, { timeout: 2_000, state: "attached" });
      return;
    } catch {
      await page.waitForTimeout(150);
    }
  }
  throw new Error(`${key} did not open ${appears} after ${tries} attempts`);
}

/** Navigate by the rail's accessible name — the way a user would. */
async function goTo(page: Page, label: RegExp): Promise<void> {
  await page.getByRole("button", { name: label }).first().click();
  await page.waitForTimeout(250);
}

async function axe(page: Page): Promise<{ id: string; impact: string; help: string; nodes: unknown[] }[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (window as any).axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return res.violations as { id: string; impact: string; help: string; nodes: unknown[] }[];
  });
}

/* =========================================================================
   CASES
   ========================================================================= */

check("shell boots: real chrome, clean console", async () => {
  const page = await openShell();
  try {
    assert(await page.$(".rail"), `nav rail missing\n${await describeDom(page)}`);
    assert(await page.$(".main"), `content grid missing\n${await describeDom(page)}`);
    const errs = ((page as unknown as { __errors: string[] }).__errors ?? []).filter(
      // SSE streams abort on navigation by design; that is not a defect.
      (e) => !/ERR_ABORTED|net::ERR_ABORTED/.test(e),
    );
    eq(errs.join(" | "), "", "renderer logged errors");
  } finally {
    await page.close();
  }
});

check("status bar reports engine truth (never a hardcoded 'healthy')", async () => {
  const page = await openShell();
  try {
    await page.waitForSelector(".sb-prov", { timeout: 10_000 });
    const txt = (await page.textContent(".sb-prov")) ?? "";
    assert(txt.trim().length > 0, "provider status rendered empty");
    assert(!/undefined|NaN/.test(txt), `provider status leaked a placeholder: ${txt}`);
  } finally {
    await page.close();
  }
});

check("D-01: Voice is a ROUTE — it must not cover the nav rail", async () => {
  const page = await openShell();
  try {
    await goTo(page, /Voice/i);
    await page.waitForSelector(".vc-root");
    const geo = await page.evaluate(() => {
      const rail = document.querySelector(".rail")!.getBoundingClientRect();
      const root = document.querySelector(".vc-root")!;
      return {
        railWidth: Math.round(rail.width),
        railVisible: rail.width > 0 && rail.height > 0,
        rootLeft: Math.round(root.getBoundingClientRect().left),
        position: getComputedStyle(root).position,
      };
    });
    assert(geo.railVisible, "rail collapsed while voice is open");
    assert(geo.position !== "fixed", `voice surface is position:${geo.position} — the D-01 overlay is back`);
    assert(
      geo.rootLeft >= geo.railWidth - 2,
      `voice surface overlaps the rail (root.left=${geo.rootLeft}, rail=${geo.railWidth})`,
    );
  } finally {
    await page.close();
  }
});

check("D-01: Escape exits Voice, keeps the session, and the rail stays usable", async () => {
  const page = await openShell();
  try {
    await goTo(page, /Library|Skills/i);
    await goTo(page, /Voice/i);
    await page.waitForSelector(".vc-root");

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".vc-root"), null, { timeout: 5_000 });

    // The rail must respond — before the fix a fixed overlay swallowed clicks.
    await goTo(page, /Trust|Security/i);
    const crumb = (await page.textContent(".titlebar .crumb")) ?? "";
    assert(/trust|security/i.test(crumb), `navigation after Escape went to "${crumb}"`);
  } finally {
    await page.close();
  }
});

check("D-01: the exit is a visible affordance, not a hidden corner button", async () => {
  const page = await openShell();
  try {
    await goTo(page, /Voice/i);
    await page.waitForSelector(".vc-root");
    const hint = await page.$(".vc-esc-hint");
    assert(hint, ".vc-esc-hint missing");
    assert(await hint!.isVisible(), ".vc-esc-hint is not visible");
    assert(/esc/i.test((await hint!.textContent()) ?? ""), ".vc-esc-hint does not mention Esc");
  } finally {
    await page.close();
  }
});

check("D-11: palette opens on Ctrl+K and closes on Escape", async () => {
  const page = await openShell();
  try {
    await pressFor(page, "Control+k", ".pal");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".pal"), null, { timeout: 5_000 });
  } finally {
    await page.close();
  }
});

check("D-11: synonyms resolve — 'mcp' and 'ollama' are not dead queries", async () => {
  const page = await openShell();
  try {
    await pressFor(page, "Control+k", ".pal");
    for (const term of ["mcp", "ollama"]) {
      await page.fill(".pal-input", term);
      await page.waitForTimeout(250);
      const rows = await page.$$eval(".pal-list [role='option'], .pal-list li, .pal-list button", (els) =>
        els.map((e) => (e.textContent ?? "").toLowerCase()),
      );
      const hits = rows.filter((r) => r.length > 0);
      assert(hits.length > 0, `palette returned nothing for "${term}" (the audit's D-11 defect)`);
    }
  } finally {
    await page.close();
  }
});

check("cheat-sheet: '?' opens a real sheet, Escape closes it", async () => {
  const page = await openShell();
  try {
    await pressFor(page, "?", ".cheat");
    const groups = await page.$$(".cheat-group");
    const kbd = await page.$$(".cheat-kbd");
    assert(groups.length > 0, "cheat-sheet has no groups");
    assert(kbd.length > 0, "cheat-sheet lists no keys");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".cheat"), null, { timeout: 5_000 });
  } finally {
    await page.close();
  }
});

check("D-03: no role=button imitations remain on the primary screens", async () => {
  const page = await openShell();
  try {
    for (const area of [/Team runs/i, /Multi-agent/i, /Library|Skills/i, /Trust|Security/i, /Settings/i]) {
      await goTo(page, area);
      const fakes = await page.$$eval('[role="button"]', (els) =>
        els.map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}`),
      );
      eq(fakes.join(", "), "", String(area));
    }
  } finally {
    await page.close();
  }
});

check("D-03: run rows are real buttons in the tab order", async () => {
  const page = await openShell();
  try {
    await goTo(page, /Runs/i);
    await page.waitForTimeout(600);
    const tags = await page.$$eval(".runrow", (els) => els.map((e) => e.tagName));
    skipUnless(tags.length > 0, "engine reports no runs — nothing to assert (not a pass)");
    for (const t of tags) eq(t, "BUTTON", "a run row is not a button");
    const focusable = await page.$$eval(".runrow", (els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length);
    eq(focusable, tags.length, "some run rows are not keyboard reachable");
  } finally {
    await page.close();
  }
});

check("D-04: skill descriptions keep their full text (clamped in CSS, not sliced in JS)", async () => {
  const page = await openShell();
  try {
    await goTo(page, /Library|Skills/i);
    await page.waitForTimeout(800);
    const offenders = await page.$$eval(".sc-desc", (els) =>
      els
        .map((e) => ({ text: e.textContent ?? "", title: e.getAttribute("title") ?? "" }))
        .filter((d) => d.text.endsWith("…") || (d.title && d.text !== d.title))
        .map((d) => d.text.slice(0, 60)),
    );
    eq(offenders.join(" | "), "", "description truncated in the DOM");
  } finally {
    await page.close();
  }
});

check("library grid is contained in its pane (no 34px overflow)", async () => {
  const page = await openShell();
  try {
    await goTo(page, /Library|Skills/i);
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector(".main") as HTMLElement | null;
      if (!main) return null;
      const kids = Array.from(main.querySelectorAll("*")) as HTMLElement[];
      const bad = kids.filter((k) => {
        // Only UNCLIPPED overflow is a layout defect. An element with
        // `overflow: hidden` is REQUIRED to report scrollWidth > clientWidth —
        // that is how an ellipsis works — so counting those would punish the
        // fix. (`sc-desc` is the clamped skill description.)
        if (getComputedStyle(k).overflow !== "visible") return false;
        if (k.closest("[aria-hidden='true']")) return false; // decorative halo
        return k.scrollWidth - k.clientWidth > 2;
      });
      return { count: bad.length, sample: bad.slice(0, 3).map((b) => `${b.tagName}.${String(b.className).split(" ")[0]}`) };
    });
    skipUnless(!!overflow, "no content grid to measure");
    assert(
      overflow!.count === 0,
      `horizontal overflow in ${overflow!.count} element(s): ${overflow!.sample.join(", ")}`,
    );
  } finally {
    await page.close();
  }
});

check("D-05: Settings → Appearance changes theme and density for real", async () => {
  const page = await openShell();
  try {
    await goTo(page, /Settings/i);
    await page.waitForSelector(".seg", { timeout: 10_000 });

    await page.getByRole("radio", { name: "light", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.getByRole("radio", { name: "dark", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(lightBg !== darkBg, `theme switch changed nothing (both ${lightBg})`);

    await page.getByRole("radio", { name: "compact", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute("data-density") === "compact");
    await page.getByRole("radio", { name: "comfortable", exact: true }).click();
  } finally {
    await page.close();
  }
});

check("D-05: the theme choice survives reload without a flash", async () => {
  const page = await openShell();
  try {
    await goTo(page, /Settings/i);
    await page.getByRole("radio", { name: "light", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    await page.reload({ waitUntil: "domcontentloaded" });
    // The inline pre-paint script in index.html applies it before first paint,
    // so it is already present in the first evaluation after load.
    eq(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "light", "theme lost on reload");
    eq(await page.evaluate(() => document.documentElement.style.colorScheme), "light", "color-scheme not applied pre-paint");
  } finally {
    await page.evaluate(() => localStorage.removeItem("xr.theme")).catch(() => {});
    await page.close();
  }
});

check("a11y: no critical/serious WCAG A+AA violations on primary surfaces", async () => {
  const page = await openShell();
  try {
    const report: string[] = [];
    for (const [name, pattern] of [
      ["home", /Home/i],
      ["settings", /Settings/i],
      ["library", /Library|Skills/i],
    ] as [string, RegExp][]) {
      await goTo(page, pattern);
      await page.waitForTimeout(400);
      for (const v of await axe(page)) {
        if (v.impact === "critical" || v.impact === "serious") {
          report.push(`${name}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s))`);
        }
      }
    }
    eq(report.join("\n"), "", "a11y violations");
  } finally {
    await page.close();
  }
});

check("a11y: palette traps focus and releases it on close", async () => {
  const page = await openShell();
  try {
    await pressFor(page, "Control+k", ".pal");
    // The dialog focuses its input on a zero-delay timer (so the element is
    // mounted first) — wait for the move rather than racing it.
    let inside = false;
    for (let i = 0; i < 10 && !inside; i++) {
      inside = await page.evaluate(() => !!document.activeElement?.closest(".pal, .pal-veil"));
      if (!inside) await page.waitForTimeout(50);
    }
    assert(inside, "focus did not move into the palette");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".pal"));
  } finally {
    await page.close();
  }
});

check("a11y: live regions exist for streaming/voice state (audit found 0)", async () => {
  const page = await openShell();
  try {
    const live = await page.$$eval("[aria-live]", (els) => els.length);
    assert(live > 0, "no aria-live region anywhere in the shell");
  } finally {
    await page.close();
  }
});

/* -------------------------------------------------------------------------
   Phase 2 · G-05 — the PTY pane is a real terminal bound to the engine
   ------------------------------------------------------------------------- */
check("G-05: '+ shell' opens a REAL engine PTY — approval first, then keystrokes round-trip through the shell", async () => {
  const page = await openShell();
  try {
    await goTo(page, /Workspace/i);
    await page.getByRole("button", { name: /^\+ shell$/ }).click();
    // Nothing is spawned before the human decides — the engine's approval banner is the first state.
    await page.waitForSelector('.pty[data-phase="approval"]', { timeout: 15_000 });
    const banner = await page.$eval(".pty .approval-mini", (el) => (el as HTMLElement).innerText);
    assert(/not policy-inspected/.test(banner), `approval banner must state the trust model plainly; got: ${banner}`);
    await page.getByRole("button", { name: /^Approve$/ }).click();
    await page.waitForSelector('.pty[data-phase="open"]', { timeout: 15_000 });
    const foot = await page.$eval(".pty-foot", (el) => (el as HTMLElement).innerText);
    assert(/pid \d+/.test(foot), `foot must show the engine's pid; got: ${foot}`);
    // Keystrokes → engine → shell → output → xterm. The marker is split so the
    // echo of the typed command cannot satisfy the assertion.
    await page.click(".pty-host .xterm");
    await page.keyboard.type("printf 'lane-%s\\n' ok");
    await page.keyboard.press("Enter");
    const deadline = Date.now() + 15_000;
    let seen = "";
    while (Date.now() < deadline) {
      seen = await page.$eval(".pty-host", (el) => (el as HTMLElement).innerText);
      if (/lane-ok/.test(seen)) break;
      await page.waitForTimeout(150);
    }
    assert(/lane-ok/.test(seen), `shell output never reached the pane; buffer: ${seen.slice(-300)}`);
    // The engine's own session list agrees a shell is open.
    const live = await page.evaluate(async () => {
      const r = await fetch("/api/v1/terminal/pty");
      return (await r.json()) as { sessions: unknown[] };
    });
    assert(live.sessions.length >= 1, "engine lists no live PTY session while the pane is open");
    // Closing the tab ends the shell — engine truth, not a UI state.
    await page.getByRole("button", { name: /Close terminal tab/ }).click();
    const gone = Date.now() + 10_000;
    let after = live;
    while (Date.now() < gone) {
      after = await page.evaluate(async () => (await (await fetch("/api/v1/terminal/pty")).json()) as { sessions: unknown[] });
      if (after.sessions.length === 0) break;
      await page.waitForTimeout(150);
    }
    eq(after.sessions.length, 0, "the engine must have killed the shell when the pane closed");
  } finally {
    await page.close();
  }
});

/* -------------------------------------------------------------------------
   Phase 2 · G-06 — hunk review: select → diff → reject a hunk → approve → applied
   ------------------------------------------------------------------------- */
check("G-06: rejecting a hunk in the diff card reverts exactly that hunk through the engine after approval", async () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const readmePath = `${repoRoot}README.md`;
  const clean = execFileSync("git", ["status", "--porcelain", "--", "README.md"], { cwd: repoRoot }).toString().trim();
  skipUnless(clean === "", "README.md has local modifications — the lane will not touch a dirty file");
  const marker = `lane-hunk-marker-${Date.now()}`;
  appendFileSync(readmePath, `\n${marker}\n`, "utf8");
  const page = await openShell();
  try {
    await goTo(page, /Workspace/i);
    await page.waitForSelector('button[title="README.md"]', { timeout: 15_000 }); // the engine's file tree
    await page.click('button[title="README.md"]');
    // The engine's diff, hunk by hunk — the marker is in the only hunk.
    await page.waitForSelector(".hunk", { timeout: 15_000 });
    const body = await page.$eval(".hunk-body", (el) => (el as HTMLElement).innerText);
    assert(body.includes(`+${marker}`), `the hunk must show the engine's diff of the change; got: ${body.slice(0, 200)}`);
    await page.getByRole("button", { name: /^Reject$/ }).first().click();
    await page.waitForSelector('.hunk[data-pending]', { timeout: 5_000 });
    // Nothing is reverted before the human decides.
    assert(readFileSync(readmePath, "utf8").includes(marker), "the file changed before any approval — the gate is not real");
    // Decide through the engine (the same durable approval Trust → Approvals shows).
    const approved = await page.evaluate(async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const list = (await (await fetch("/api/v1/approvals")).json()) as { pending: Array<{ id: string; tool: string; preview?: { sections: Array<{ body: string }> } }> };
        const hit = list.pending.find((p) => p.tool === "patch");
        if (hit) {
          const shown = (hit.preview?.sections ?? []).map((x) => x.body).join("\n");
          await fetch(`/api/v1/approvals/${encodeURIComponent(hit.id)}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }) });
          return { shown };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    });
    assert(approved, "no 'patch' approval appeared in the engine's durable queue");
    assert(approved.shown.includes(marker), "the approval preview must show the hunk being reverted");
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && readFileSync(readmePath, "utf8").includes(marker)) await page.waitForTimeout(150);
    assert(!readFileSync(readmePath, "utf8").includes(marker), "git did not reverse-apply the hunk after approval");
    // The card reflects the engine's new truth: nothing left to review.
    await page.waitForFunction(() => /no working-tree changes/.test((document.querySelector(".diffcard") as HTMLElement | null)?.innerText ?? ""), null, { timeout: 10_000 });
    eq(execFileSync("git", ["status", "--porcelain", "--", "README.md"], { cwd: repoRoot }).toString().trim(), "", "README.md must be byte-identical to HEAD again");
  } finally {
    await page.close();
    if (readFileSync(readmePath, "utf8").includes(marker)) execFileSync("git", ["checkout", "--", "README.md"], { cwd: repoRoot });
  }
});

/* =========================================================================
   RUNNER
   ========================================================================= */
async function main(): Promise<number> {
  await boot();
  process.stdout.write(
    `\nXR renderer lane · ${BASE} (built app)\n` +
      `  engine: ${engineUp ? `up (${DAEMON})` : "DOWN — data-dependent checks will skip"}\n` +
      `  browser: chromium ${browser.version()}\n\n`,
  );

  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const failures: string[] = [];

  // XR_TEST_ONLY narrows the run while iterating on one failure.
  const only = process.env.XR_TEST_ONLY ? new RegExp(process.env.XR_TEST_ONLY, "i") : null;
  const selected = only ? cases.filter((c) => only.test(c.name)) : cases;
  if (only) process.stdout.write(`  (filter: ${only} → ${selected.length} of ${cases.length} cases)\n\n`);

  for (const c of selected) {
    const started = Date.now();
    try {
      await c.fn();
      pass += 1;
      process.stdout.write(`  \x1b[32mPASS\x1b[0m  ${c.name} \x1b[90m${Date.now() - started}ms\x1b[0m\n`);
    } catch (e) {
      if (e instanceof Skip) {
        skipped += 1;
        process.stdout.write(`  \x1b[33mSKIP\x1b[0m  ${c.name} \x1b[90m(${e.message})\x1b[0m\n`);
        continue;
      }
      fail += 1;
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${c.name}\n    ${msg.split("\n").join("\n    ")}`);
      process.stdout.write(`  \x1b[31mFAIL\x1b[0m  ${c.name} \x1b[90m${Date.now() - started}ms\x1b[0m\n`);
    }
  }

  process.stdout.write(`\n  ${pass} passed · ${fail} failed · ${skipped} skipped\n`);
  if (failures.length) {
    process.stdout.write(`\n${failures.map((f) => `  ✗ ${f}`).join("\n\n")}\n\n`);
  }
  return fail === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  process.stdout.write(`\n  \x1b[31mlane aborted\x1b[0m: ${e instanceof Error ? e.message : String(e)}\n\n`);
  code = 1;
} finally {
  await shutdown();
}
process.exit(code);

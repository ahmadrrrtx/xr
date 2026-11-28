import { describe, expect, test } from "bun:test";
import { DASHBOARD_SCRIPT } from "../../src/daemon/dashboard.ts";

function dashboardFailureRenderer(): (code: string | null, message: string) => string {
  const start = DASHBOARD_SCRIPT.indexOf("function chatFailureText(code, message)");
  const end = DASHBOARD_SCRIPT.indexOf("async function streamChat", start);
  if (start < 0 || end < 0) throw new Error("dashboard chat failure renderer is missing");
  return new Function(`${DASHBOARD_SCRIPT.slice(start, end)}; return chatFailureText;`)() as (code: string | null, message: string) => string;
}

describe("unpriced chat UX", () => {
  test("the dashboard turns an unpriced stop into an actionable message, never a budget stop", () => {
    const render = dashboardFailureRenderer();
    const text = render("unpriced", "price unavailable: no request sent");
    expect(text).toContain("This model has no known price");
    expect(text).toContain("Pick a priced model or set a rate");
    expect(text).toContain("price unavailable: no request sent");
    expect(text).not.toMatch(/budget limit|budget ceiling/i);
    expect(DASHBOARD_SCRIPT).toContain("chatFailureText(streamErrorCode,streamError)");
    expect(DASHBOARD_SCRIPT).toContain("j.stopped==='unpriced'");
  });

  test("the dashboard still describes a true budget stop as budget", () => {
    expect(dashboardFailureRenderer()("budget", "budget ceiling reached")).toBe(
      "Budget limit reached: budget ceiling reached",
    );
  });
});

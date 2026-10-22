/**
 * Try each configured token in precedence order (XR-LAUNCH-034).
 *
 * Pure (no `vscode` import) so it is unit-tested and smoke-tested against a
 * real daemon. A 401/403 moves on to the next source; any other failure stops
 * (the daemon is unhealthy, trying more tokens would not help).
 */

import { DaemonClient, DaemonHttpError, type BudgetResponse, type ProvidersResponse } from "./client";
import { describeSource, type ResolvedToken } from "./token";

export type ConnectResult =
  | { kind: "connected"; token: ResolvedToken; budget: BudgetResponse; providers: ProvidersResponse }
  | { kind: "no-token" }
  | { kind: "rejected"; sources: string[] }
  | { kind: "error"; error: unknown };

export async function connectWithTokens(
  tokens: ResolvedToken[],
  makeClient: (token: string) => Pick<DaemonClient, "budget" | "providers">,
): Promise<ConnectResult> {
  if (tokens.length === 0) return { kind: "no-token" };
  const rejected: string[] = [];
  for (const token of tokens) {
    const probe = makeClient(token.token);
    try {
      const [budget, providers] = await Promise.all([probe.budget(), probe.providers()]);
      return { kind: "connected", token, budget, providers };
    } catch (err) {
      if (err instanceof DaemonHttpError && (err.status === 401 || err.status === 403)) {
        rejected.push(describeSource(token.source));
        continue;
      }
      return { kind: "error", error: err };
    }
  }
  return { kind: "rejected", sources: rejected };
}

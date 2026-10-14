/**
 * XR Phase 31 · Bucket A (A3) — cloud webhook entry points.
 *
 * Phase 30 owns everything under src/cloud/ (billing/SSO); Bucket A must
 * not implement Stripe verification here. This module is only the seam
 * where that verification will land.
 */

// TODO(P30): verify stripe-signature here before any billing event is
// trusted (Stripe-Signature header, webhook signing secret from the
// SecretBroker, raw-body HMAC-SHA256, 401 on mismatch). Do not implement
// in Phase 31 — billing is Phase 30's scope.

export {};

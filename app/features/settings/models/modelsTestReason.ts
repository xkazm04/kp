"use client";

import { useTranslations } from "next-intl";

// One localized reason per canary failure CODE, shared by both Test buttons: the
// routing pin's (/api/llm/test) and the stored key's (/api/llm/keys/test).
//
// Both routes already classify a provider failure into a stable code and refuse
// to forward the provider's own text (app/api/llm/test/verdict.ts) — but until
// now the client threw that code away: `errMsg(payload, t("testFailed"))`
// resolves through the `errors` namespace, which carries none of these codes, so
// every failure collapsed to a flat "Test failed." An operator then cannot tell
// a wrong key from a rate limit from a firewall, which are three completely
// different fixes. This maps the code the server already computed onto copy that
// says which one it was.
//
// Unknown code (a future one the catalog hasn't caught up with) falls back to the
// caller's generic message rather than rendering a raw id.

/** The failure codes the canary routes emit. Mirrors TestErrorCode in
 *  app/api/llm/test/verdict.ts, plus the two the keys route adds for the cases it
 *  refuses before spawning anything. */
export const MODELS_TEST_CODES = [
  "auth",
  "rate_limit",
  "connection",
  "timeout",
  "invalid_model",
  "permission",
  "unavailable",
  "bad_payload",
  "provider_error",
  "model_required",
  "not_found",
  "unknown_provider",
] as const;

export type ModelsTestCode = (typeof MODELS_TEST_CODES)[number];

/** Runtime guard for the closed vocabulary above - the literal-array + derived-union
 *  + guard shape this repo uses for every closed set (tabs.ts, i18n/locales.ts).
 *  A verdict carrying a code the catalog does not cover (a newer server, a proxy's
 *  own envelope) resolves to null and the caller falls back, so a raw id can never
 *  be rendered as if it were copy. */
export function isModelsTestCode(value: unknown): value is ModelsTestCode {
  return typeof value === "string" && (MODELS_TEST_CODES as readonly string[]).includes(value);
}

export type ModelsTestVerdict = {
  ok?: boolean;
  provider?: string;
  model?: string;
  latencyMs?: number;
  code?: string;
  error?: string;
};

/** The catalog key a verdict resolves to, or null for "fall back". Pure and
 *  DOM-free, so the resolution rule - which code wins, and what an unknown one
 *  does - is unit-testable without next-intl; the hook is the thin translating
 *  wrapper over it. */
export function testReasonKeyFor(verdict: ModelsTestVerdict | null | undefined): ModelsTestCode | null {
  return isModelsTestCode(verdict?.code) ? verdict.code : null;
}

/** Resolve a verdict's code to a localized reason, or `fallback` when the code is
 *  absent or not in the catalog. Never returns the server's `error` string. */
export function useTestReason(): (verdict: ModelsTestVerdict | null | undefined, fallback: string) => string {
  const t = useTranslations("models.testReason");
  type ReasonKey = Parameters<typeof t>[0];
  return (verdict, fallback) => {
    const key = testReasonKeyFor(verdict);
    if (!key) return fallback;
    return t.has(key as ReasonKey) ? t(key as ReasonKey) : fallback;
  };
}

"use client";

import { useTranslations } from "next-intl";
import { resolveErrorMessage, type ApiErrorPayload } from "./use-error-message";

/*
 * The GitHub deep-dive's failure resolver.
 *
 * /api/github-analysis answers a failure with `{ error, code }` like every other
 * route (docs/architecture/localization.md), but its codes describe ONE optional
 * feature — an org handle, a GitHub 403, our own per-IP throttle — so they live in
 * this surface's own `results.github.errors` namespace instead of the app-wide
 * `errors` one. Same rule, same pure resolver (use-error-message.ts): show the
 * code, never the server's English `error`.
 *
 * Three call sites run this analysis (the Analyze report, the dev-submission row,
 * the pipeline candidate drawer) and each used to throw `new Error(payload.error)`
 * — the indirect form of the `body.error ?? t(…)` trap, invisible to both the
 * eslint rule and the leak grep because the English arrives through a variable.
 */
export function useGithubErrorMessage(): (payload: ApiErrorPayload | null | undefined, fallback: string) => string {
  const t = useTranslations("results.github.errors");
  type ErrorKey = Parameters<typeof t>[0];
  return (payload, fallback) =>
    // The code is a runtime string, so cast at the boundary — the existence check
    // guards against a code this catalog doesn't know.
    resolveErrorMessage(
      payload,
      fallback,
      (code) => t.has(code as ErrorKey),
      (code) => t(code as ErrorKey)
    );
}

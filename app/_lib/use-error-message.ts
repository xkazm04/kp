"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

/*
 * One rule, in one place: an API failure is shown to the user from its machine
 * `code`, never from the server's English `error` string.
 *
 * Route handlers return `{ error, code }` (see STORE_ERRORS / safeJsonError in
 * api-response.ts). The `error` half is canonical English, written for the
 * server log and for API consumers; the `code` half is what the UI resolves,
 * through the `errors` catalog namespace, in the reader's language.
 *
 * The trap this closes: `body.error ?? t("saveFailed")` reads like a sensible
 * fallback chain but is backwards — `error` is almost always present, so the
 * localized fallback almost never runs and every locale gets English. That
 * pattern was on 84 call sites across 26 directories, including surfaces the
 * i18n lint already held at `error` level (the lint reads JSX text nodes, so it
 * cannot see English arriving through a variable). Prefer the code; fall back to
 * the caller's already-localized message; never show `error`.
 */

/** What a failed API response looks like to the UI. `error` is typed but never
 *  read by the resolver — it is here so a call site can pass the parsed body
 *  straight in without destructuring. */
export interface ApiErrorPayload {
  code?: string | null;
  error?: string | null;
}

/** Resolve a payload to a localized message, given a bound `errors` translator.
 *  Pure, so plain (non-React) helper modules can follow the same rule by taking
 *  a resolver from their caller instead of reaching for a hook. */
export function resolveErrorMessage(
  payload: ApiErrorPayload | null | undefined,
  fallback: string,
  has: (code: string) => boolean,
  translate: (code: string) => string
): string {
  const code = payload?.code;
  if (code && has(code)) return translate(code);
  return fallback;
}

/** The hook form, for components and other hooks.
 *
 *  STABLE IDENTITY, deliberately: the resolver is memoized on the translator, so
 *  it is safe in a `useCallback`/`useMemo`/`useEffect` dependency array. It used
 *  to be a bare arrow re-created on every render, and a resolver that changes
 *  identity every render is not a formatter — it is a render-loop trigger: put it
 *  in a fetching effect's deps and the effect re-fires on the very re-render its
 *  own setState caused. Two call sites had already routed AROUND this hook to
 *  escape that (app/features/library/jds/jdsHooks.ts read the catalog key
 *  directly; app/features/shell/useWorkspaceCommandPaletteSearch.ts re-wrapped
 *  the pure resolveErrorMessage in its own useCallback), which is the shape of a
 *  primitive that has to be worked around rather than used.
 *
 *  `t` from next-intl is itself a useMemo over the intl context, so it only
 *  changes when the locale or the catalog does — which is exactly when a bound
 *  resolver SHOULD change. */
export function useErrorMessage(): (payload: ApiErrorPayload | null | undefined, fallback: string) => string {
  const t = useTranslations("errors");
  type ErrorKey = Parameters<typeof t>[0];
  return useCallback(
    (payload: ApiErrorPayload | null | undefined, fallback: string) =>
      // `t.has`/`t` are typed to known keys; the code is a runtime string, so cast
      // at the boundary — the existence check guards against an unknown code.
      resolveErrorMessage(
        payload,
        fallback,
        (code) => t.has(code as ErrorKey),
        (code) => t(code as ErrorKey)
      ),
    [t]
  );
}

/** The bound resolver's type. Non-hook helpers take one of these as a parameter
 *  so the call site (a component or hook) supplies it. */
export type ErrorMessageResolver = ReturnType<typeof useErrorMessage>;

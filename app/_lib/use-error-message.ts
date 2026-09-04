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
  translate: (code: string, values?: ErrorMessageValues) => string,
  values?: ErrorMessageValues
): string {
  const code = payload?.code;
  if (code && has(code)) return translate(code, values);
  // No values on this branch on purpose: the fallback is a string the caller has
  // already localized and interpolated, not a catalog key we could fill in.
  return fallback;
}

/** ICU placeholder values for a code whose message carries numbers or names
 *  ("You have used {used} of {limit}"). Before this existed such a message had
 *  to be assembled at the call site, which put it outside the `errors` catalog
 *  and therefore outside every locale but English. */
export type ErrorMessageValues = Record<string, string | number | Date>;

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
export function useErrorMessage(): (
  payload: ApiErrorPayload | null | undefined,
  fallback: string,
  values?: ErrorMessageValues
) => string {
  const t = useTranslations("errors");
  type ErrorKey = Parameters<typeof t>[0];
  return useCallback(
    (payload: ApiErrorPayload | null | undefined, fallback: string, values?: ErrorMessageValues) =>
      // `t.has`/`t` are typed to known keys; the code is a runtime string, so cast
      // at the boundary — the existence check guards against an unknown code.
      resolveErrorMessage(
        payload,
        fallback,
        (code) => t.has(code as ErrorKey),
        // `values` is untyped against the catalog for the same reason the key is:
        // the code arrives at runtime, so no key-specific value shape is knowable
        // here. A message with no placeholders simply ignores them.
        (code, vals) => t(code as ErrorKey, vals as never),
        values
      ),
    [t]
  );
}

/** The bound resolver's type. Non-hook helpers take one of these as a parameter
 *  so the call site (a component or hook) supplies it. */
export type ErrorMessageResolver = ReturnType<typeof useErrorMessage>;

/** The localized sentence for a refusal that may carry a capability.
 *
 *  gated-doors-clients-read-the-refusal — the write doors answer a seat without the
 *  permission with a coded 403 (FORBIDDEN_CAPABILITY) carrying `capability`. The
 *  code's OWN message (errors.FORBIDDEN_CAPABILITY) is deliberately
 *  placeholder-free, because a dozen consumers resolve it with no values and a
 *  required ICU argument would break every one of them; a client that HOLDS the
 *  data renders the client variant `errors.forbiddenCapabilityNeeds` instead, which
 *  names the permission the operator has to ask for.
 *
 *  Takes the bound resolver rather than calling the hook, so a non-hook helper can
 *  fold a refusal exactly the same way as a component.
 *
 *  It lives HERE, not in the add-to-pipeline transport module it was born in: eight
 *  surfaces import it and only two of them add a candidate. This module is the one
 *  every client already imports for the rule it implements. */
export function capabilityAwareReason(
  resolve: ErrorMessageResolver,
  payload: (ApiErrorPayload & { capability?: string | null }) | null | undefined,
  fallback: string
): string {
  const generic = resolve(payload, fallback);
  if (payload?.code !== "FORBIDDEN_CAPABILITY" || !payload.capability) return generic;
  return resolve({ code: "forbiddenCapabilityNeeds" }, generic, { capability: payload.capability });
}

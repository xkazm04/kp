import { resolveCommsLocale } from "./comms-locale";
import type { Locale } from "@/i18n/locales";
import { namespaceTranslator, type CatalogTranslator } from "./catalog-translator";

/*
 * A locale-pinned `comms` translator for code that writes to a CANDIDATE rather
 * than to the person holding the browser.
 *
 * `useTranslations()` resolves the *request's* locale — right for UI, wrong for
 * an email: the letter must be written in the candidate's language, which is
 * stored on their pipeline entry, not in the recruiter's cookie.
 *
 * Extracted from comms-dispatch.ts, which had this cache privately, once
 * devcase-feedback.ts needed the same thing. The cache + the catalog loader have
 * since moved one level down into catalog-translator.ts, because the interview-prep
 * pack and the copy-to-job-board posting need the SAME mechanism for other
 * namespaces (and one of them runs on the client, where the `resolveCommsLocale`
 * DB read below cannot go). What stays here is the part that is genuinely about
 * comms: resolving WHICH locale a candidate hears from us in.
 */

/** The shape a dynamically-loaded translator has. Re-exported under its historical
 *  name so the dispatchers' `t: CommsTranslator` parameters are unchanged. */
export type CommsTranslator = CatalogTranslator;

/** Translator for the `comms` namespace, pinned to the candidate's locale.
 *  Synchronous after the first load per locale.
 *
 *  THE TENANT IS PART OF THE QUESTION. `resolveCommsLocale` falls back to the
 *  WORKSPACE's `default_locale` when the candidate has no recorded language, so a
 *  caller that hands over a raw, possibly-NULL locale and no workspace resolves
 *  against the DEFAULT team — writing to a second team's NULL-locale candidate in
 *  the default team's language. That defect was fixed dispatcher-by-dispatcher and
 *  kept regrowing here, because the signature allowed it: `commsTranslator(x)`
 *  compiled whatever `x` was.
 *
 *  The overloads make it a TYPE error instead of a review question:
 *    • one argument is accepted ONLY for an ALREADY-RESOLVED `Locale` (what
 *      `candidateLocale`/`resolveCommsLocale` return — re-resolving one is
 *      idempotent and needs no tenant);
 *    • a raw `string | null | undefined` MUST be paired with the workspace it
 *      belongs to.
 *  Pass `null` for the tenant only where there genuinely is none, and say why. */
export async function commsTranslator(locale: Locale): Promise<CommsTranslator>;
export async function commsTranslator(
  locale: string | null | undefined,
  workspaceId: string | null | undefined
): Promise<CommsTranslator>;
export async function commsTranslator(
  locale: string | null | undefined,
  workspaceId?: string | null
): Promise<CommsTranslator> {
  return namespaceTranslator(resolveCommsLocale(locale, workspaceId ?? undefined), "comms");
}

import { resolveCommsLocale } from "./comms-locale";
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
 *  Synchronous after the first load per locale. */
export async function commsTranslator(locale: string | null | undefined): Promise<CommsTranslator> {
  return namespaceTranslator(resolveCommsLocale(locale), "comms");
}

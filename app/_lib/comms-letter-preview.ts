// The offer letter, SHOWN before it is sent (challenge-r06 comms-dispatch-relay/B).
//
// The offer approval card asked a recruiter to approve a letter they never saw. The
// letter is assembled only at dispatch (comms-dispatch.ts dispatchOffer): the model's
// body, then the deterministic terms (a deadline the recruiter's ttlDays decides, the
// start date), then the response footer, then the GDPR data + opt-out footers, in the
// CANDIDATE's resolved language. This module renders that exact text through the SAME
// composer (composeOfferLetter + renderCandidateFooters) and states, before the click,
// whether it will reach anyone.
//
// SIDE-EFFECT FREE, by construction: no token is minted (the offer link and both
// footer links carry PREVIEW_TOKEN), no offer row is created, nothing is recorded.
// Every read below is a read: the entry the caller already holds, the relay config,
// the consent snapshots the send gate consults.
//
// THE FORECAST is read off the send path's own predicates, in the order the send path
// applies them (sendCandidateComm -> sendCommUnlessSim -> sendComm):
//   refused    - no recipient exists by design (an agent on the slate).
//   simulation - a (SIM)-titled role: recorded on the simulation channel, never relayed.
//   suppressed - the send gate will refuse it (consent expired, erased, halted).
//   relay      - a real relay is configured; the letter is handed to it.
//   local      - no relay: recorded in the local outbox, which is its destination.
// Deliberately NOT imported by any route that sends a letter: it pulls in the send
// gate's store reads, and the letter-sending routes sit at their import-graph budget.
import type { PipelineEntry } from "./db/core";
import { candidateRecipient, composeOfferLetter, renderCandidateFooters } from "./comms-dispatch";
import { recipientRefusal } from "./comms-recipient";
import { commsSendSuppression } from "./comms";
import { isRelayConfigured } from "./comms-relay";
import { resolveCommsLocale } from "./comms-locale";
import { commsTranslator } from "./comms-translator";
import { isSimTitle } from "@/app/features/shell/simulation/constants";
import { offerExpiresAtMs, resolveOfferTtlDays } from "./offer-policy";
import { publicBaseUrl } from "./public-base-url.ts";
import type { Locale } from "@/i18n/locales";

/** Stands in for every capability token in a previewed letter. Never a real token. */
export const PREVIEW_TOKEN = "preview";

export const OFFER_LETTER_FORECASTS = ["relay", "local", "refused", "suppressed", "simulation"] as const;
export type OfferLetterForecast = (typeof OFFER_LETTER_FORECASTS)[number];

export type OfferLetterPreview = {
  /** The language the letter is written in: the candidate's, not the recruiter's. */
  locale: Locale;
  subject: string;
  /** The full body the candidate receives, legal footers included, links as placeholders. */
  body: string;
  /** Who the letter is addressed to, or null when it has no recipient by design. */
  recipient: string | null;
  forecast: OfferLetterForecast;
  /** A short code naming why (agent_population, consent_expired, no_contact...), or null. */
  forecastReason: string | null;
  /** The whole-day window actually applied (resolveOfferTtlDays) and the deadline it yields. */
  ttlDays: number;
  expiresAt: string;
};

type PreviewEntry = PipelineEntry & { population?: string | null };

function parseDraft(detail: string | null | undefined): { subject?: unknown; body?: unknown; startDate?: unknown } {
  try {
    const parsed = detail ? JSON.parse(detail) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // An unparseable draft previews as the empty letter dispatchOffer would send for it.
    return {};
  }
}

function forecastFor(entry: PreviewEntry, recipient: string | null): { forecast: OfferLetterForecast; reason: string | null } {
  if (recipient === null) return { forecast: "refused", reason: recipientRefusal(entry) ? "agent_population" : null };
  if (isSimTitle(entry.jobTitle)) return { forecast: "simulation", reason: null };
  const suppressed = commsSendSuppression({ to: recipient, subject: "", body: "", kind: "offer", ref: entry.id, workspaceId: entry.workspaceId });
  if (suppressed) return { forecast: "suppressed", reason: suppressed };
  if (isRelayConfigured()) return { forecast: "relay", reason: (entry.contact ?? "").trim() ? null : "no_contact" };
  return { forecast: "local", reason: null };
}

/** Render the offer letter an approval of `entry` would send, with `ttlDays` as the
 *  deadline lever, and forecast its delivery. Writes nothing. */
export async function previewOfferLetter(
  entry: PreviewEntry,
  opts: { ttlDays?: number | null; now?: number; origin?: string | null } = {}
): Promise<OfferLetterPreview> {
  const draft = parseDraft(entry.approvalDetail);
  const locale = resolveCommsLocale(entry.locale, entry.workspaceId ?? undefined);
  const t = await commsTranslator(locale);
  const ttlDays = resolveOfferTtlDays(opts.ttlDays);
  const expiresAt = new Date(offerExpiresAtMs(opts.now ?? Date.now(), ttlDays)).toISOString();
  const base = publicBaseUrl(opts.origin ?? null);
  const letter = composeOfferLetter(entry, draft, {
    link: `${base}/offer/${PREVIEW_TOKEN}`,
    expiresAt,
    startDate: typeof draft.startDate === "string" ? draft.startDate : null,
    locale,
    t,
  });
  const recipient = candidateRecipient(entry);
  // The same skip rule as candidateFooters: a refused or erased entry gets no footers.
  const footers =
    recipient !== null && !entry.anonymizedAt && entry.id
      ? renderCandidateFooters(t, locale, base, { erasureToken: PREVIEW_TOKEN, optOutToken: PREVIEW_TOKEN }).text
      : "";
  const { forecast, reason } = forecastFor(entry, recipient);
  return {
    locale,
    subject: letter.subject,
    body: letter.body + footers,
    recipient,
    forecast,
    forecastReason: reason,
    ttlDays,
    expiresAt,
  };
}

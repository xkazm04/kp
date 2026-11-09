// The ONE assembly of what a held outreach letter shows (GET ./[id] and GET ./by-entry/[entryId]):
// the stored draft, the exact letter its release would send (legal footers appended, every
// capability link a placeholder) and its delivery forecast. READ-ONLY.
import type { PipelineEntry } from "@/app/_lib/db/core";
import type { OutreachLetter } from "@/app/_lib/db/outreach-letters";
import { PREVIEW_TOKEN, type OfferLetterForecast } from "@/app/_lib/comms-letter-preview";
import { candidateRecipient, renderCandidateFooters } from "@/app/_lib/comms-dispatch";
import { recipientRefusal } from "@/app/_lib/comms-recipient";
import { commsSendSuppression } from "@/app/_lib/comms";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { commsTranslator } from "@/app/_lib/comms-translator";
import { resolveCommsLocale } from "@/app/_lib/comms-locale";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { isSimTitle } from "@/app/_lib/sim-marker";

export async function outreachLetterView(letter: OutreachLetter, entry: PipelineEntry, ws: string, origin: string) {
  const locale = resolveCommsLocale(letter.lang, ws);
  const t = await commsTranslator(locale);
  const recipient = candidateRecipient(entry);
  // The same skip rule as the send path's candidateFooters: a refused or erased entry
  // gets no footers.
  const footers =
    recipient !== null && !entry.anonymizedAt
      ? renderCandidateFooters(t, locale, publicBaseUrl(origin), {
          erasureToken: PREVIEW_TOKEN,
          optOutToken: PREVIEW_TOKEN,
        }).text
      : "";
  let forecast: OfferLetterForecast;
  let forecastReason: string | null = null;
  if (recipient === null) {
    forecast = "refused";
    forecastReason = recipientRefusal(entry) ? "agent_population" : null;
  } else if (isSimTitle(entry.jobTitle)) {
    forecast = "simulation";
  } else {
    // commsSendSuppression is the channel's own gate for kind "outreach": consent,
    // erasure, then the halted sequence (replied / manual / the candidate's opt-out).
    const suppressed = commsSendSuppression({ to: recipient, subject: "", body: "", kind: "outreach", ref: entry.id, workspaceId: ws });
    if (suppressed) {
      forecast = "suppressed";
      forecastReason = suppressed;
    } else if (isRelayConfigured()) {
      forecast = "relay";
      forecastReason = (entry.contact ?? "").trim() ? null : "no_contact";
    } else {
      forecast = "local";
    }
  }
  return {
    letter: {
      id: letter.id,
      entryId: letter.entryId,
      state: letter.state,
      revision: letter.revision,
      subject: letter.subject,
      body: letter.body,
      lang: letter.lang,
      messageId: letter.messageId,
      approvedBy: letter.approvedBy,
      approvedAt: letter.approvedAt,
      releasedAt: letter.releasedAt,
      createdAt: letter.createdAt,
      updatedAt: letter.updatedAt,
    },
    preview: {
      locale,
      subject: letter.subject ?? "",
      body: (letter.body ?? "") + footers,
      recipient,
      forecast,
      forecastReason,
    },
  };
}

//   GET /api/outreach-letters/[id] -> { letter, preview }
//     letter  { id, entryId, state, revision, subject, body, lang, messageId,
//               approvedBy, approvedAt, releasedAt, createdAt, updatedAt }
//     preview { locale, subject, body, recipient, forecast, forecastReason }
//
// A held first-contact outreach (comms scope C2) and the letter its release would send:
// the stored draft plus the legal footers every candidate comm carries, with every
// capability link replaced by comms-letter-preview.ts's PREVIEW_TOKEN, and a delivery
// forecast read off the send path's own predicates in the order it applies them (the
// offer preview's vocabulary: refused / simulation / suppressed / relay / local). The
// `revision` is what an approval must name (POST ./approve).
//
// READ-ONLY: no token is minted, nothing is recorded. AUTH: the letter carries the
// candidate's name and address — the recruiter PII class of /api/pipeline/[id]/offer-letter,
// so requireOperator runs first and every read is scoped to the caller's workspace (a
// letter id from another team answers 404).
import { NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { outreachLetterById } from "@/app/_lib/db/outreach-letters";
import { PREVIEW_TOKEN, type OfferLetterForecast } from "@/app/_lib/comms-letter-preview";
import { candidateRecipient, renderCandidateFooters } from "@/app/_lib/comms-dispatch";
import { recipientRefusal } from "@/app/_lib/comms-recipient";
import { commsSendSuppression } from "@/app/_lib/comms";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { commsTranslator } from "@/app/_lib/comms-translator";
import { resolveCommsLocale } from "@/app/_lib/comms-locale";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { isSimTitle } from "@/app/_lib/sim-marker";

export const GET = withWorkspace(async (ws: string, request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const letter = outreachLetterById(id, ws);
    if (!letter) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    const entry = getPipelineEntry(letter.entryId, ws);
    if (!entry) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);

    const locale = resolveCommsLocale(letter.lang, ws);
    const t = await commsTranslator(locale);
    const recipient = candidateRecipient(entry);
    // The same skip rule as the send path's candidateFooters: a refused or erased entry
    // gets no footers.
    const footers =
      recipient !== null && !entry.anonymizedAt
        ? renderCandidateFooters(t, locale, publicBaseUrl(new URL(request.url).origin), {
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

    return NextResponse.json({
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
    });
  } catch (error) {
    return safeJsonError(error, "api:outreach-letters", "OUTREACH_FAILED");
  }
});

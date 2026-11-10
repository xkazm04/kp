import { getPipelineEntry, setApproval } from "@/app/_lib/db/pipeline";
import { getJob } from "@/app/_lib/db/jobs";
import { REFUSAL_ERRORS } from "@/app/_lib/api-response";
import { namespaceTranslator } from "@/app/_lib/catalog-translator";
import { resolveCommsLocale } from "@/app/_lib/comms-locale";
import { getWorkspaceMarket } from "@/app/_lib/workspace-market";
import { validateOfferTerms } from "@/app/_lib/offer-policy";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { stageHasRole } from "@/app/_lib/pipeline-stages";
import { BAND_OTHER_CURRENCY, bandInOtherUnit, normalizeSalaryBand } from "@/app/_lib/salary-band";

// A recruiter's own offer draft: the keyless way to an offer for a real entry
// (docs/features/hiring-pipeline/keyless-rating.md). The AI draft (automation task
// "offer") needs an analyzed profile, which a quick-apply candidate does not have, and
// the /api/sim doors admit only demo rows and stay that way.
//
// It writes the approval and nothing else. The offer is extended only when a person
// approves the offer_review card, through extendDraftedOffer, so offer-policy, the
// idempotent token and the sealed offer_terms apply exactly as for an AI draft.
//
// Deliberately no `offer_drafted` event: that kind is attributed to automation
// (decision-attribution.ts) and counted as saved work, and this is a person's act.

export type ManualOfferResult = { status: number; body: Record<string, unknown> };

const notAvailable = (entry: unknown): ManualOfferResult => ({
  status: 409,
  body: { error: REFUSAL_ERRORS.OFFER_DRAFT_NOT_AVAILABLE, code: "OFFER_DRAFT_NOT_AVAILABLE", entry },
});

/** A figure the recruiter typed, else the midpoint of the job's own band, else none.
 *  Absent means absent: no market guess, because an invented number reaches a candidate. */
export function manualOfferFigure(typed: unknown, band: readonly [number, number] | null): unknown {
  if (typed !== undefined && typed !== null && typed !== "") return typed;
  return band ? Math.round((band[0] + band[1]) / 2) : null;
}

export async function draftManualOffer(input: { id: string; workspaceId: string; salary?: unknown }): Promise<ManualOfferResult> {
  const { id, workspaceId } = input;
  const entry = getPipelineEntry(id, workspaceId);
  if (!entry) {
    return { status: 404, body: { error: REFUSAL_ERRORS.PIPELINE_ENTRY_NOT_FOUND, code: "PIPELINE_ENTRY_NOT_FOUND" } };
  }
  const axis = getPipelineAxis(workspaceId).stages;
  if (entry.status !== "active" || entry.approvalKind !== null || !stageHasRole(entry.stage, "offer", axis)) {
    return notAvailable(entry);
  }

  // A typed figure must be a number or a numeric string: Number(true) is 1 and
  // Number([5]) is 5, and "abc" would otherwise fall through as unpriced.
  const typed = input.salary;
  const present = typed !== undefined && typed !== null && typed !== "";
  if (present && !(typeof typed === "number" || (typeof typed === "string" && typed.trim() !== "" && Number.isFinite(Number(typed))))) {
    return { status: 400, body: { error: REFUSAL_ERRORS.OFFER_SALARY_INVALID, code: "OFFER_SALARY_INVALID" } };
  }

  const job = entry.jobId ? getJob(entry.jobId, workspaceId) : null;
  const stored = job?.salaryBand ?? [];
  const market = getWorkspaceMarket(workspaceId);
  // The offer is denominated in the market's currency, so a band set in another unit (the
  // market changed since) prices nothing and bounds nothing: never converted, stated.
  const otherUnit = stored.length >= 2 && bandInOtherUnit(job, market);
  const band = otherUnit ? null : normalizeSalaryBand(stored[0], stored[1]);
  const terms = validateOfferTerms({ salary: manualOfferFigure(input.salary, band), currency: market.currency });
  if (!terms.ok) return { status: 400, body: { error: REFUSAL_ERRORS[terms.code], code: terms.code, max: terms.max } };

  // The letter dispatchOffer sends, so it is written in the candidate's language. It
  // names no figure: the terms are shown on the offer page.
  const t = await namespaceTranslator(resolveCommsLocale(entry.locale, entry.workspaceId), "simulation");
  const role = entry.jobTitle?.trim() || t("draft.theRole");
  const draft = {
    subject: t("draft.offer.subject", { role }),
    body: t("draft.offer.body", { name: entry.candidateLabel?.trim() || t("draft.theCandidate"), role }),
    currency: terms.currency,
    recommended: terms.salary,
    salaryMin: band ? band[0] : null,
    salaryMax: band ? band[1] : null,
    ...(otherUnit ? { bandAbsence: BAND_OTHER_CURRENCY } : {}),
    // The card's disclosure: this letter is a template, not a model's judgment.
    verdictSource: "template",
  };

  // The await above yielded the event loop: re-read before writing, so an entry rejected,
  // closed or moved off the offer step in the gap does not get an offer_review card.
  const fresh = getPipelineEntry(id, workspaceId);
  if (!fresh) {
    return { status: 404, body: { error: REFUSAL_ERRORS.PIPELINE_ENTRY_NOT_FOUND, code: "PIPELINE_ENTRY_NOT_FOUND" } };
  }
  if (fresh.status !== "active" || fresh.approvalKind !== null || !stageHasRole(fresh.stage, "offer", axis)) {
    return notAvailable(fresh);
  }

  // CAS on "no decision open", so a draft cannot overwrite one raised since the read.
  const written = setApproval(id, "offer_review", JSON.stringify(draft), workspaceId, { expectedApprovalKind: null });
  if (!written) return notAvailable(getPipelineEntry(id, workspaceId));
  return { status: 200, body: { entry: getPipelineEntry(id, workspaceId), draft } };
}

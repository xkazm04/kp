// The simulation's two DETERMINISTIC drafts — the screening recommendation and the
// offer — composed from the catalogs instead of hardcoded English.
//
// These are not scratch strings: both land in the real product surfaces. The
// screening draft becomes the `screening_review` approval card the recruiter reads
// in the Decisions queue, and the offer draft's subject/body is the letter
// dispatchOffer actually sends to the candidate (comms-dispatch). They were English
// literals inside /api/sim/screen-draft and /api/sim/offer-draft, so a Czech, German
// or French workspace watched the tour narrate its keyless spine in Czech and then
// got "Strong fit for … — core skills present" and "We're delighted to extend you an
// offer" in English, under its own brand.
//
// Pure by design (a translator in, plain objects out): the routes resolve WHICH
// locale — the entry's own, falling back to its team's default, the same
// resolveCommsLocale precedence every candidate letter uses — and these compose in
// it, so a per-locale test needs neither a request scope nor a DB.
import type { CatalogTranslator } from "@/app/_lib/catalog-translator";

/** The `simulation` namespace's translator, pinned to the draft's locale. */
export type SimDraftTranslator = CatalogTranslator;

export type SimScreenDraft = {
  recommendation: "advance";
  confidence: number;
  rationale: string;
  strengths: string[];
  redFlags: string[];
};

export type SimOfferDraft = {
  subject: string;
  body: string;
  currency: string;
  recommended: number;
  salaryMin: number;
  salaryMax: number;
  rationale: string;
};

/** Confidence the deterministic screener reports. A fixed number, not a fake
 *  measurement: the demo spine runs with no LLM, and the value is the same on every
 *  run so the tour's narration and the card agree. */
export const SIM_SCREEN_CONFIDENCE = 72;

export function buildSimScreenDraft(t: SimDraftTranslator, role: string | null | undefined): SimScreenDraft {
  return {
    recommendation: "advance",
    confidence: SIM_SCREEN_CONFIDENCE,
    rationale: t("draft.screen.rationale", { role: role?.trim() || t("draft.theRole") }),
    strengths: [t("draft.screen.strengthStack"), t("draft.screen.strengthSeniority")],
    redFlags: [],
  };
}

export function buildSimOfferDraft(
  t: SimDraftTranslator,
  input: { role: string | null | undefined; candidate: string | null | undefined; currency: string; recommended: number; salaryMin: number; salaryMax: number }
): SimOfferDraft {
  const role = input.role?.trim() || t("draft.theRole");
  return {
    subject: t("draft.offer.subject", { role }),
    body: t("draft.offer.body", { name: input.candidate?.trim() || t("draft.theCandidate"), role }),
    currency: input.currency,
    recommended: input.recommended,
    salaryMin: input.salaryMin,
    salaryMax: input.salaryMax,
    rationale: t("draft.offer.rationale"),
  };
}

"use client";

// The role's Candidates tab — the fair-comparison lens over the saved pool.
//
// It used to be two side-by-side columns of nine-badge cards (experienced /
// early-career), which spent a screen on a dozen people and had no way into the
// one place a candidate is actually read. It is now a THIN frame: the honest
// facts of the surface (the cap note, the toggles and their consequences, the
// skipped-candidate note, the fairness audit) plus a switcher over three layouts
// of the SAME rows, and a row click opens the candidate modal.
//
// The layouts live in candidates/ and share one row model (candidatesModel.ts),
// so a variant is a shape and never a different claim. The bridge from a ranked
// row to the entry-shaped modal is documented in candidates/useCandidateBridge.ts.

import { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Scale, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, CHIP_TOGGLE, NOTICE, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { CandidateModal } from "@/app/features/hiring/pipeline/candidate/CandidateModal";
import { isEarlyCareer } from "./JobsTypes";
import { SkippedCandidatesNote } from "./JobsShared";
import { useRecruiterCandidatesLogic } from "./jobsRecruiterCandidatesLogic";
import { FairnessAuditPanel } from "./JobsRecruiterCandidatesFairness";
import { CandidatesGrid } from "./candidates/CandidatesGrid";
import { CandidatesLadder } from "./candidates/CandidatesLadder";
import { CandidatesRungs } from "./candidates/CandidatesRungs";
import { CandidatePreviewModal } from "./candidates/CandidatePreviewModal";
import { useCandidateBridge } from "./candidates/useCandidateBridge";
import {
  buildLadderRows,
  CANDIDATE_VARIANTS,
  orderNotEligible,
  readVariant,
  writeVariant,
  type CandidateVariant,
} from "./candidates/candidatesModel";

const LAYOUTS = { ladder: CandidatesLadder, rungs: CandidatesRungs, grid: CandidatesGrid } as const;

export function RecruiterCandidates({
  jobId,
  jobTitle,
  roleFamily,
  autoLoad = false,
}: {
  jobId: string;
  jobTitle: string;
  roleFamily: string | null;
  autoLoad?: boolean;
}) {
  const t = useTranslations("jobs.candidates");
  const logic = useRecruiterCandidatesLogic({ jobId, jobTitle, roleFamily, autoLoad });
  const bridge = useCandidateBridge(jobId);
  // Lazy initializer: localStorage is read once, on mount, not on every render.
  const [variant, setVariant] = useState<CandidateVariant>(() => readVariant());

  const rows = useMemo(
    () => buildLadderRows(logic.shownOrdered, { fair: logic.fairLookup, early: (c) => isEarlyCareer(c.archetype) }),
    [logic.shownOrdered, logic.fairLookup],
  );
  const notEligible = useMemo(
    () => orderNotEligible(buildLadderRows(logic.notEligibleRows)),
    [logic.notEligibleRows],
  );

  const pick = (next: CandidateVariant) => {
    setVariant(next);
    writeVariant(next);
  };

  if (!logic.data) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 p-3">
        <button
          type="button"
          onClick={logic.load}
          disabled={logic.loading}
          className={`${BTN_SECONDARY} cursor-pointer px-3 py-1.5 text-sm`}
        >
          {logic.loading ? t("scoring") : t("scoreCandidates")}
        </button>
        {logic.error ? <span className="ml-2 text-sm text-red-700">{logic.error}</span> : null}
      </div>
    );
  }

  const Layout = LAYOUTS[variant];
  return (
    <div className="rounded-md border border-stone-200 p-3">
      <p role="status" aria-live="polite" className="sr-only">
        {[logic.announce, logic.reachAnnounce].filter(Boolean).join(" ")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-coral">{t("title")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {logic.poolFitCount > 0 ? (
            <button
              type="button"
              onClick={() => logic.setPoolFitOnly((v) => !v)}
              aria-pressed={logic.poolFitOnly}
              title={t("poolFitTitle")}
              className={`${CHIP_TOGGLE(logic.poolFitOnly)} cursor-pointer px-2.5 py-0.5`}
            >
              <Users size={13} /> {t("poolFit", { count: logic.poolFitCount })}
            </button>
          ) : null}
          {logic.hasFairness ? (
            <button
              type="button"
              onClick={() => logic.setFairRank((v) => !v)}
              aria-pressed={logic.fairActive}
              title={t("fairRankTitle")}
              className={`${CHIP_TOGGLE(logic.fairActive)} cursor-pointer px-2.5 py-0.5`}
            >
              <Scale size={13} /> {t("fairRank")}
            </button>
          ) : null}
          <span className="text-sm text-steel">{t("notEligible", { count: logic.notEligible })}</span>
          <span className={TOGGLE_GROUP} role="group" aria-label={t("layoutLabel")}>
            {CANDIDATE_VARIANTS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => pick(v)}
                aria-pressed={variant === v}
                className={`${toggleBtn(variant === v)} cursor-pointer`}
              >
                {t(`layout_${v}`)}
              </button>
            ))}
          </span>
        </div>
      </div>

      <p className="mt-1 text-sm text-steel">{t("earlyCareerNote")}</p>
      <p className="mt-1 text-sm text-steel">{t("fairnessShielded")}</p>
      {logic.poolFitOnly ? <p className="mt-1 text-sm text-steel">{t("poolFitNote")}</p> : null}
      {logic.fairActive ? <p className="mt-1 text-sm text-steel">{t("fairRankNote")}</p> : null}
      <SkippedCandidatesNote skipped={logic.skipped} />
      {/* The pool was capped (route's `poolTruncated`): say so where the ranking,
          the KO count and the Pool-Fit count are read. A cut slice presented as
          the whole pool is the shape this tab must never take — so the note is on
          the FRAME, above whichever layout is showing, not inside one of them. */}
      {logic.poolTruncated ? (
        <p role="note" className={`${NOTICE("amber")} mt-2 px-2.5 py-1.5 text-sm`}>{t("poolTruncatedNote")}</p>
      ) : null}

      <div className="mt-3">
        <Layout rows={rows} notEligible={notEligible} opening={bridge.opening} onOpen={bridge.open} />
      </div>

      {logic.hasFairness ? (
        <FairnessAuditPanel
          fairness={logic.fairness!}
          fairById={logic.fairById}
          poolTruncated={logic.poolTruncated}
          onExport={logic.exportFairness}
        />
      ) : null}

      {bridge.preview ? (
        <CandidatePreviewModal
          c={bridge.preview}
          onClose={bridge.closePreview}
          added={logic.added(bridge.preview.candidateId)}
          adding={logic.adding(bridge.preview.candidateId)}
          addError={logic.cardError(bridge.preview.candidateId)}
          onAdd={logic.addToPipeline}
          reached={logic.reached(bridge.preview.candidateId)}
          reaching={logic.reaching(bridge.preview.candidateId)}
          reachError={logic.reachError(bridge.preview.candidateId)}
          onReach={logic.reachOut}
        />
      ) : null}
      <AnimatePresence>
        {bridge.view ? (
          <CandidateModal
            key="jobs-candidates-candidate"
            view={bridge.view}
            boardCohort={[]}
            axis={bridge.axis}
            onClose={bridge.close}
            onChanged={bridge.invalidate}
            onOpenEntry={bridge.openEntryById}
            onNavigate={bridge.navigate}
            onTab={bridge.setTab}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

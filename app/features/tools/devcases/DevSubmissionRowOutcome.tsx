"use client";

// Post-promote "review + record outcome" strip (Hired/Rejected/Withdrawn, plus the
// on-the-job performance picker), split out of DevSubmissionRow.tsx.
//
// It hand-rolled six button class strings and printed `outcome: hired` — the raw enum
// — beside a control room that already localizes those same three words. Buttons now
// compose BTN_SECONDARY, the pill composes CHIP_QUIET, and the outcome word comes from
// `useOutcomeLabel` (control.outcomes.value), which is the ledger this row writes into.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useOutcomeLabel } from "./DevLabels";

type OutcomeKind = "hired" | "rejected" | "withdrawn";
type OutcomeState = { recorded: OutcomeKind | null; pickingPerf: boolean; busy: boolean; error: string | null };

export function DevSubmissionRowOutcome({
  recorded,
  outcome,
  setOutcome,
  recordSubmissionOutcome,
}: {
  recorded: OutcomeKind | null;
  outcome: OutcomeState;
  setOutcome: React.Dispatch<React.SetStateAction<OutcomeState>>;
  recordSubmissionOutcome: (kind: OutcomeKind, performance?: number) => void;
}) {
  const t = useTranslations("devcase.outcomeStrip");
  const outcomeLabel = useOutcomeLabel();
  const btn = `${BTN_SECONDARY} h-6 px-1.5 text-micro font-semibold capitalize`;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-micro">
      {/* Promote files a pipeline entry + a Decisions review card — link to
          where the promoted candidate actually went instead of ending here. */}
      <Link
        href="/?tab=decisions"
        className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline"
      >
        {t("reviewInDecisions")} <ArrowRight size={11} aria-hidden />
      </Link>
      {recorded ? (
        <span
          className={`${CHIP_QUIET} text-micro font-semibold uppercase ${
            recorded === "hired" ? "bg-moss/15 text-moss" : "bg-stone-100 text-steel"
          }`}
        >
          {t("recorded", { outcome: outcomeLabel(recorded) })}
        </span>
      ) : outcome.pickingPerf ? (
        <>
          <span className="uppercase tracking-wide text-steel">{t("perfLabel")}</span>
          {[1, 2, 3, 4, 5].map((perf) => (
            <button
              key={perf}
              type="button"
              disabled={outcome.busy}
              aria-label={t("perfAria", { n: perf })}
              onClick={() => void recordSubmissionOutcome("hired", perf)}
              className={`${BTN_SECONDARY} h-6 w-6 justify-center text-micro font-semibold hover:border-moss/50`}
            >
              {perf}
            </button>
          ))}
          <button
            type="button"
            disabled={outcome.busy}
            onClick={() => void recordSubmissionOutcome("hired")}
            className={`${BTN_SECONDARY} h-6 px-1.5 text-micro font-semibold text-steel`}
          >
            {t("skipPerf")}
          </button>
        </>
      ) : (
        <>
          <span className="uppercase tracking-wide text-steel" title={t("hint")}>
            {t("label")}
          </span>
          <button
            type="button"
            disabled={outcome.busy}
            onClick={() => setOutcome((o) => ({ ...o, pickingPerf: true, error: null }))}
            className={`${btn} border-moss/40 text-moss`}
          >
            {outcomeLabel("hired")}
          </button>
          <button
            type="button"
            disabled={outcome.busy}
            onClick={() => void recordSubmissionOutcome("rejected")}
            className={`${btn} text-coral`}
          >
            {outcomeLabel("rejected")}
          </button>
          <button
            type="button"
            disabled={outcome.busy}
            onClick={() => void recordSubmissionOutcome("withdrawn")}
            className={`${btn} text-steel`}
          >
            {outcomeLabel("withdrawn")}
          </button>
        </>
      )}
      {outcome.error ? (
        <span role="alert" className="text-red-700">
          {outcome.error}
        </span>
      ) : null}
    </div>
  );
}

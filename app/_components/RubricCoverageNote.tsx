"use client";

// The one disclosure for "this rubric lost its industry axes" — rendered by BOTH
// the interview-prep pack header and the human scorecard form, so the pack a
// recruiter reads and the scorecard they fill can never disagree about what the
// rubric covers.
//
// Layered on the repo's existing degraded-source idiom (PrepHeader's fallback /
// jdEditedSince notices, JdsCandidateList's stale chip): amber notice for a real
// gap, quiet steel line for a fact. It self-translates from the `rubricCoverage`
// namespace rather than taking a prop-drilled `t`, because its two call sites sit
// in different namespaces (scheduleTab.prep and scheduleTab.scorecard) and one
// catalog beats two copies of the same sentence.
//
// THREE cases, two of which render — see RUBRIC_COVERAGE_GAPS:
//   • no_family           — we do not know the role family, so we cannot know which
//                           axes apply. Something is missing → amber, role="status".
//   • family_no_axes      — a canonical family that has no industry axes BY DESIGN
//                           (ten of sixteen: software_engineering, data_ai,
//                           finance_accounting …). The base rubric is the intended
//                           rubric here, so this renders NOTHING. Disclosing it
//                           would fire on the majority of interviews and turn the
//                           notice into wallpaper, costing `no_family` its signal.
//   • family_unrecognized — a family outside the canonical taxonomy: a real data
//                           anomaly → a quiet factual line, not an alarm.
// The silence is structural, not a branch here: `isDisclosedGap` is driven by
// RUBRIC_COVERAGE_DISCLOSED_GAPS, and the message catalog is pinned to that same
// tuple — so a silent gap has no string it could render even if this gate slipped.
// No branch ever names a guessed family: `coverage.roleFamily` is the entry's own
// value or null (see rubricCoverage).

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { isDisclosedGap, type RubricCoverage } from "@/app/_lib/interview-rubric";

export function RubricCoverageNote({ coverage, className = "" }: { coverage: RubricCoverage; className?: string }) {
  const t = useTranslations("rubricCoverage");
  const enumLabel = useEnumLabel();

  if (!isDisclosedGap(coverage.gap)) return null;

  if (coverage.gap === "no_family") {
    return (
      <p
        role="status"
        className={`flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-meta text-amber-800 ${className}`}
      >
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden /> {t("no_family")}
      </p>
    );
  }

  // family_unrecognized. `family` is the entry's own string echoed back — by
  // definition NOT a canonical slug, so useEnumLabel's labelize() fallback is what
  // actually renders it. Showing the raw-ish value is the point: it is the anomaly.
  return (
    <p role="status" className={`flex items-start gap-1.5 text-meta text-steel ${className}`}>
      <Info size={13} className="mt-0.5 shrink-0" aria-hidden />{" "}
      {t("family_unrecognized", { family: enumLabel("family", coverage.roleFamily) })}
    </p>
  );
}

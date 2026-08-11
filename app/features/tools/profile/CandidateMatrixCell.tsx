"use client";

// Single matrix cell (profile or CV-analysis candidate), split out of CandidateMatrix.tsx.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { buildUrl } from "@/app/features/shell/tabs";
import type { CandidateRow } from "@/app/features/shared/profileTypes";

export function CandidateMatrixCell({ cand, onEditProfile }: { cand: CandidateRow; onEditProfile: (id: string) => void }) {
  const t = useTranslations("profile.matrix");
  const tp = useTranslations("scoreProvenance");
  const router = useRouter();
  // Route by store: a profile opens the editor (the same ?edit= flow, invoked
  // directly since a same-tab query change wouldn't re-fire the mount effect); an
  // analysis opens its Analyze output at /history/<slug>. A cheap source chip marks
  // which store a cell came from — no per-source column explosion.
  const isProfile = cand.source === "profile";
  // Build-from-analysis: promote an analyzed CV into a saved, matchable profile
  // prefilled from the analysis and STAMPED with source lineage (?fromAnalysis=),
  // so a later re-analysis of the same CV surfaces as staleness on the profile.
  const buildFromAnalysis = () =>
    cand.slug && router.push(buildUrl({ tab: "archetypes", fromAnalysis: cand.slug }, ""));
  const cellClass =
    "focus-ring group block w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-left hover:border-coral/50 hover:bg-coral/5";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-ink group-hover:text-coral">{cand.name}</span>
        {/* The number is the CV-analysis total, NOT a match score — a bare badge
            reads as a fit score, so an analysis cell carries a compact provenance
            cue in the app's canonical vocabulary ("from CV analysis"). Profile
            cells have no score (em-dash) and stay a plain badge. */}
        {!isProfile && cand.score != null ? (
          <span className="flex shrink-0 flex-col items-end gap-0.5" title={tp("analysisShort")}>
            <ScoreBadge score={cand.score} />
            <span className="text-micro font-medium uppercase tracking-wide text-steel">{tp("analysisShort")}</span>
          </span>
        ) : (
          <ScoreBadge score={cand.score} />
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm capitalize text-steel">
          {cand.role ?? "—"}
          {cand.seniority ? ` · ${cand.seniority}` : ""}
        </p>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide ${
            isProfile ? "bg-coral/10 text-coral" : "bg-stone-100 text-steel"
          }`}
        >
          {isProfile ? t("sourceProfile") : t("sourceAnalysis")}
        </span>
      </div>
    </>
  );
  return isProfile ? (
    <button type="button" onClick={() => cand.id && onEditProfile(cand.id)} className={cellClass} title={t("openProfileTitle", { name: cand.name })}>
      {body}
    </button>
  ) : (
    <div className="space-y-1">
      <Link href={`/history/${cand.slug}`} className={cellClass} title={t("openAnalysisTitle", { name: cand.name })}>
        {body}
      </Link>
      <button
        type="button"
        onClick={buildFromAnalysis}
        className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel hover:text-coral"
        title={t("buildFromAnalysisTitle", { name: cand.name })}
      >
        <UserPlus size={12} aria-hidden /> {t("buildFromAnalysis")}
      </button>
    </div>
  );
}

"use client";

// Everything the compact card stopped printing: role, role family, seniority in
// words, which store the candidate came from, and what that score actually is.
//
// This is the other half of the card redesign. Moving the metadata here is only
// honest if it is genuinely REACHABLE — one click on the name — and if the modal
// then says more than the card did, not the same seven fields in a bigger box. So
// it also carries the provenance sentence (an analysis total is not a match score)
// and both routes onward.
//
// The row is one CANDIDATE, keyed on CV identity (app/_lib/candidate-population.ts):
// a saved profile arrives with every analysis of the CV it was built from folded in,
// so the modal lists them — the profile's route back to its evidence, and the
// candidate's footprint across the roles that CV was analysed against.

import Link from "next/link";
import { ExternalLink, Pencil, UserPlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { archetypeDisplayKey } from "@/app/_lib/archetypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { CandidateRow } from "@/app/features/shared/profileTypes";
import { matrixChipAction } from "@/app/_lib/candidate-population";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={META_LABEL}>{label}</span>
      <span className="text-base text-ink">{value}</span>
    </div>
  );
}

export function CandidateDetailModal({
  cand,
  onClose,
  onEditProfile,
  onBuildFromAnalysis,
}: {
  cand: CandidateRow;
  onClose: () => void;
  onEditProfile: (id: string) => void;
  onBuildFromAnalysis: (slug: string) => void;
}) {
  const t = useTranslations("profile.matrix");
  const tp = useTranslations("scoreProvenance");
  const enumLabel = useEnumLabel();
  const format = useFormatter();
  const isProfile = cand.source === "profile";
  const action = matrixChipAction(cand);
  const dash = "—";

  return (
    <Modal
      title={cand.name}
      subtitle={isProfile ? t("sourceProfile") : t("sourceAnalysis")}
      onClose={onClose}
      size="lg"
      footer={
        action?.kind === "edit" ? (
          <button
            type="button"
            onClick={() => {
              onEditProfile(action.id);
              onClose();
            }}
            className={`${BTN_PRIMARY} h-10 px-4`}
          >
            <Pencil size={15} aria-hidden /> {t("openProfileAction")}
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (cand.slug) onBuildFromAnalysis(cand.slug);
                onClose();
              }}
              className={`${BTN_PRIMARY} h-10 px-4`}
            >
              <UserPlus size={15} aria-hidden /> {t("buildFromAnalysis")}
            </button>
            {cand.slug ? (
              <Link href={`/history/${cand.slug}`} className={`${BTN_SECONDARY} h-10 px-4`}>
                <ExternalLink size={15} aria-hidden /> {t("openAnalysisAction")}
              </Link>
            ) : null}
          </span>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Fact label={t("colArchetype")} value={enumLabel("archetype", archetypeDisplayKey(cand.archetype))} />
        <Fact label={t("colSeniority")} value={cand.seniority ? enumLabel("seniority", cand.seniority) : dash} />
        <Fact label={t("colFamily")} value={cand.role ? enumLabel("family", cand.role) : dash} />
        <div className="flex flex-col gap-0.5">
          <span className={META_LABEL}>{t("colScore")}</span>
          <span className="flex items-center gap-2">
            <ScoreBadge score={cand.score} />
            {/* The number on an analysis row is the CV-analysis total, NOT a match
                score against a job — a bare badge reads as a fit score, so the
                distinction is stated in the app's canonical vocabulary. A saved
                profile has no score of its own at all. */}
            <span className="text-sm text-steel">{cand.score == null && isProfile ? t("scoreProfileNote") : tp("analysisShort")}</span>
          </span>
        </div>
      </div>
      {/* Every analysis of this CV, newest first. Shown for a profile whenever its CV
          has one, and for an analysis-only candidate once the CV was analysed more than
          once (a single analysis is already the footer's "Open analysis"). */}
      {cand.analyses.length > 0 && (isProfile || cand.analyses.length > 1) ? (
        <div className="mt-5 flex flex-col gap-2">
          <span className={META_LABEL}>{t("analysesOfCv", { count: cand.analyses.length })}</span>
          <ul className="flex flex-col gap-1.5">
            {cand.analyses.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/history/${a.slug}`}
                  className="focus-ring flex items-center gap-2 rounded-md px-2 py-1 text-sm text-ink hover:bg-stone-100 hover:text-coral"
                >
                  <ScoreBadge score={a.score} />
                  <span className="min-w-0 flex-1 truncate">{format.dateTime(new Date(a.createdAt), { dateStyle: "medium" })}</span>
                  <ExternalLink size={13} aria-hidden className="shrink-0 text-steel" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}

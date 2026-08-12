"use client";

// Everything the compact card stopped printing: role, role family, seniority in
// words, which store the candidate came from, and what that score actually is.
//
// This is the other half of the card redesign. Moving the metadata here is only
// honest if it is genuinely REACHABLE — one click on the name — and if the modal
// then says more than the card did, not the same seven fields in a bigger box. So
// it also carries the provenance sentence (an analysis total is not a match score)
// and both routes onward.

import Link from "next/link";
import { ExternalLink, Pencil, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { archetypeDisplayKey } from "@/app/_lib/archetypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { CandidateRow } from "@/app/features/shared/profileTypes";

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
  const isProfile = cand.source === "profile";
  const dash = "—";

  return (
    <Modal
      title={cand.name}
      subtitle={isProfile ? t("sourceProfile") : t("sourceAnalysis")}
      onClose={onClose}
      size="lg"
      footer={
        isProfile ? (
          <button
            type="button"
            onClick={() => {
              if (cand.id) onEditProfile(cand.id);
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
            <span className="text-sm text-steel">{isProfile ? t("scoreProfileNote") : tp("analysisShort")}</span>
          </span>
        </div>
      </div>
    </Modal>
  );
}

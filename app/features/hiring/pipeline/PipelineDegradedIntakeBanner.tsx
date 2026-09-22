"use client";

// Degraded-intake recovery banner: shown when a stub failed intake
// normalization, with a "mark captured" action that clears the flag once the
// profile is captured manually. Split out of PipelineCandidateDrawer.tsx.

import { AlertTriangle, ExternalLink, Pencil, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useIntakeReasonText } from "./pipelineEventCatalog";

export function PipelineDegradedIntakeBanner({
  reason,
  resolving,
  intakeErr,
  onResolve,
  onOpenProfile,
  candidateId,
}: {
  reason: string | null | undefined;
  resolving: boolean;
  intakeErr: string | null;
  onResolve: () => void;
  onOpenProfile?: () => void;
  candidateId?: string | null;
}) {
  const t = useTranslations("pipeline.drawer");
  const tAction = useTranslations("pipeline.candidateRow");
  const router = useRouter();
  const search = useSearchParams();
  // The stored reason is a CODE for anything the lead intake filed; legacy rows (and
  // the CV pipeline's normalization messages) come back verbatim. See useIntakeReasonText.
  const reasonText = useIntakeReasonText()(reason);
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-red-700">
        <AlertTriangle size={13} /> {t("intakeDegradedTitle")}
      </p>
      <p className="mt-1 text-sm text-ink">
        {t.rich("intakeDegradedBody", { b: (chunks) => <span className="font-semibold">{chunks}</span> })}
      </p>
      {reasonText ? (
        <p className="mt-1.5 break-words rounded bg-white/70 px-2 py-1 text-meta text-steel">{reasonText}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onResolve}
          disabled={resolving}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          <Wrench size={13} aria-hidden /> {resolving ? t("resolving") : t("markCaptured")}
        </button>
        {onOpenProfile ? (
          <button type="button" onClick={onOpenProfile} className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100">
            <ExternalLink size={13} aria-hidden /> {tAction("openProfile")}
          </button>
        ) : null}
        {candidateId ? (
          <button type="button" onClick={() => router.push(buildUrl({ tab: "archetypes", edit: candidateId }, search.toString()))} className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100">
            <Pencil size={13} aria-hidden /> {t("editProfile")}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-meta text-steel">{t("clearsFlagNote")}</p>
      {intakeErr ? <p role="alert" className="mt-1.5 text-sm text-red-700">{intakeErr}</p> : null}
    </div>
  );
}

"use client";

// Distribution + intake for a case — each posting is an apply channel; the
// candidates they collect are ranked together in the shortlist above. Split out
// of DevCaseDetail.tsx.
import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { PANEL } from "@/app/_components/ui/recipes";
import { ApplyTokenPill } from "./DevApplyTokenPill";
import { SubmissionForm } from "./DevSubmissionForm";
import type { Posting } from "./DevTypes";

export function DevCaseDetailChannels({ casePostings, onDone }: { casePostings: Posting[]; onDone: () => void }) {
  const t = useTranslations("devcase.studio.channels");
  if (casePostings.length === 0) return null;
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <ClipboardList size={13} className="text-coral" /> {t("title")}
        <span className="text-coral">· {casePostings.length}</span>
      </h3>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        {casePostings.map((p) => (
          <div key={p.id} className={`${PANEL} p-3`}>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-paper px-2 py-0.5 text-micro font-semibold uppercase text-steel">{p.channel}</span>
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{p.caseTitle || p.roleTitle || t("posting")}</span>
              <span className="text-micro text-steel">{t("received", { count: p.submissions?.length ?? p.submissionCount ?? 0 })}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="shrink-0 text-micro uppercase tracking-wide text-steel">{t("applyLink")}</span>
              <ApplyTokenPill token={p.token} />
            </div>
            <SubmissionForm postingId={p.id} onDone={onDone} />
          </div>
        ))}
      </div>
    </section>
  );
}

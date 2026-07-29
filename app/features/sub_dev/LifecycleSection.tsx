"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LoadState } from "@/app/_lib/useLoader";
import { DevSection } from "./DevShared";
import { LifecycleRow } from "./LifecycleRow";
import type { Lifecycle, Posting } from "./DevTypes";

export function LifecycleSection({
  lifecycles,
  postings,
  approveLifecycle,
  state,
  onChanged,
}: {
  lifecycles: Lifecycle[];
  // d8a0c4cf — to count submissions per lifecycle (by caseId) for the stall flag.
  postings: Posting[];
  approveLifecycle: (id: string) => void;
  state: LoadState;
  /** W5-3 — refresh after a close-out flips a lifecycle to its terminal stage. */
  onChanged?: () => void;
}) {
  const t = useTranslations("devcase.lifecycle");
  // Submissions per case, summed across its postings — the stall check's "empty?".
  const submissionsByCase = new Map<string, number>();
  for (const p of postings) {
    if (!p.caseId) continue;
    const n = p.submissions?.length ?? p.submissionCount ?? 0;
    submissionsByCase.set(p.caseId, (submissionsByCase.get(p.caseId) ?? 0) + n);
  }
  return (
    <DevSection icon={<Sparkles size={13} className="text-coral" />} title={t("sectionTitle")} count={lifecycles.length} state={state} label="lifecycles">
      <p className="mt-1 text-micro text-steel">{t("intro")}</p>
      <div className="mt-3 space-y-2">
        {lifecycles.map((lc) => (
          <LifecycleRow
            key={lc.id}
            lc={lc}
            submissionCount={lc.caseId ? submissionsByCase.get(lc.caseId) ?? 0 : 0}
            onApprove={() => approveLifecycle(lc.id)}
            onChanged={onChanged}
          />
        ))}
      </div>
    </DevSection>
  );
}

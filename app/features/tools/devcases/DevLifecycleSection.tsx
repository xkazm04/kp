"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LoadState } from "@/app/_lib/useLoader";
import { DevSection } from "./DevShared";
import { LifecycleRow } from "./DevLifecycleRow";
import type { Lifecycle } from "./DevTypes";

// Each row carries its own intake counts (GET /api/devcase/lifecycle, challenge-r09
// devcase-lifecycle/A): submissions for the d8a0c4cf stall flag, in-flight attempts for the
// close confirm. The section used to take the workspace's whole postings fold only to fold
// it back down to those two numbers per case.
export function LifecycleSection({
  lifecycles,
  approveLifecycle,
  state,
  onChanged,
  focus = null,
}: {
  lifecycles: Lifecycle[];
  approveLifecycle: (id: string) => void;
  state: LoadState;
  /** W5-3 — refresh after a close-out flips a lifecycle to its terminal stage. */
  onChanged?: () => void;
  /** The lifecycle an address pointed at (?lifecycle=): scrolled in, review opened
   *  when it awaits approval. See assignmentsDeepLink.ts. */
  focus?: { id: string; openReview: boolean; nonce: number } | null;
}) {
  const t = useTranslations("devcase.lifecycle");
  return (
    <DevSection icon={<Sparkles size={13} className="text-coral" />} title={t("sectionTitle")} count={lifecycles.length} state={state} label="lifecycles">
      <p className="mt-1 text-micro text-steel">{t("intro")}</p>
      <div className="mt-3 space-y-2">
        {lifecycles.map((lc) => (
          <LifecycleRow
            key={lc.id}
            lc={lc}
            submissionCount={lc.submissionCount ?? 0}
            inFlight={lc.inFlight ?? null}
            onApprove={() => approveLifecycle(lc.id)}
            onChanged={onChanged}
            focus={focus?.id === lc.id ? focus : null}
          />
        ))}
      </div>
    </DevSection>
  );
}

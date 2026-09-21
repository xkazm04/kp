"use client";

// What the footer's buttons produce, shown in a tray ABOVE the bar so the tab being
// read stays in place: an AI action's progress and result (or its localized failure),
// or one of the two tokenized candidate links with its delivery truth.

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { ResultView } from "../../PipelineCandidateResultView";
import { PipelineSelfSchedulingPanel } from "../../PipelineSelfSchedulingPanel";
import { PipelineVoiceScreenPanel } from "../../PipelineVoiceScreenPanel";
import type { CandidateState } from "../state/useCandidateState";

export type TrayView = "result" | "voice" | "schedule";

export function CandidateFooterTray({
  view,
  entry,
  st,
  onClose,
}: {
  view: TrayView;
  entry: Entry;
  st: CandidateState;
  onClose: () => void;
}) {
  const t = useTranslations("pipeline.candidate.footer");
  const tDrawer = useTranslations("pipeline.drawer");

  return (
    <div className="max-h-[45dvh] overflow-y-auto border-b border-stone-200 bg-paper px-4 py-4 sm:px-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          {view === "result" ? (
            <>
              {st.busy ? (
                <p className="text-sm text-steel" aria-live="polite">
                  {tDrawer("working")}
                </p>
              ) : null}
              {/* The LOCALIZED sentence; the runner's English diagnostic rides along
                  only as a tooltip for whoever is debugging. */}
              {st.error ? (
                <p role="alert" title={st.errorDetail ?? undefined} className="rounded-md bg-red-50 p-2.5 text-sm text-red-700">
                  {st.error}
                </p>
              ) : null}
              {st.result ? <ResultView result={st.result} roleFamily={entry.roleFamily} /> : null}
            </>
          ) : view === "voice" ? (
            <PipelineVoiceScreenPanel
              target={{ entryId: entry.id }}
              voiceProvider={st.voiceProvider}
              onProviderChange={st.setVoiceProvider}
              voice={st.voice}
              revokeNote={st.revokeNote}
              onRevoke={() => void st.revokeLinks()}
            />
          ) : (
            <PipelineSelfSchedulingPanel entryId={entry.id} sched={st.sched} />
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeTray")}
          title={t("closeTray")}
          className={`${BTN_GHOST} h-8 w-8 shrink-0 cursor-pointer justify-center`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

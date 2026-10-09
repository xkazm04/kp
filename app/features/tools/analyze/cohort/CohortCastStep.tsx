"use client";

// Act 2: who is compared. Reads the proposal for the role, seeds the tray from it, and lays
// the tray (edit who sits) beside the run sheet (what the run will do, and Start). The tray is
// this step's own state: a role change remounts the step (keyed by the role) and starts clean.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_GHOST, BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import type { CohortProposal, CohortRunRequest } from "./cohortTypes";
import { addMember, removeMember, trayFromProposal } from "./cohortProposalEdits";
import { useCohortProposal } from "./useCohortProposal";
import { CohortProposalTray } from "./CohortProposalTray";
import { CohortRunSheet } from "./CohortRunSheet";

type Props = {
  jdSlug: string;
  onCount: (n: number) => void;
  onStarted: (cohortId: string, request: CohortRunRequest) => void;
  onBack: () => void;
};

export function CohortCastStep({ jdSlug, onCount, onStarted, onBack }: Props) {
  const t = useTranslations("analyzeCohort.shell.cast");
  const errorMessage = useErrorMessage();
  const p = useCohortProposal(jdSlug);
  if (p.state === "loading") return <LoadingGap className="min-h-[20rem]" label={t("loading")} />;
  if (p.state === "failed") {
    return (
      <div role="alert" className={`${NOTICE("critical")} flex flex-wrap items-center gap-3 px-4 py-3 text-body`}>
        <span className="flex-1">{errorMessage(p.failure, t("failed"), p.failure.values)}</span>
        <button type="button" onClick={p.reload} className={`${BTN_SECONDARY} h-9 bg-white px-4 text-body`}>
          {t("retry")}
        </button>
        <button type="button" onClick={onBack} className={`${BTN_GHOST} h-9 px-4 text-body`}>
          {t("otherRole")}
        </button>
      </div>
    );
  }
  return <CohortCast proposal={p.proposal} onCount={onCount} onStarted={onStarted} />;
}

function CohortCast({ proposal, onCount, onStarted }: { proposal: CohortProposal } & Pick<Props, "onCount" | "onStarted">) {
  const [tray, setTray] = useState(() => trayFromProposal(proposal));
  const count = tray.members.length;
  useEffect(() => onCount(count), [count, onCount]);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <CohortProposalTray
        proposal={proposal}
        tray={tray}
        onRemove={(id) => setTray((cur) => removeMember(cur, id))}
        onAdd={(m) => setTray((cur) => addMember(cur, m).tray)}
      />
      <CohortRunSheet proposal={proposal} tray={tray} onStarted={onStarted} />
    </div>
  );
}

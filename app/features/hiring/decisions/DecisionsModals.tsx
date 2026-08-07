"use client";

// Modal wiring for the Decisions tab: the analysis-summary modal, the
// group-eval modal, the rules modal and the screening-wave modal. Split out
// of DecisionsTab so that shell stays under the 200-line cap. The two heavy
// modals (analysis summary, screen wave) load as separate chunks — see the
// Tier 3 note in DecisionsTab.tsx / docs/design/loading-choreography.md.
import dynamic from "next/dynamic";
import { DecisionRulesModal } from "./DecisionsRulesModal";
import { GroupEvalModal, type GroupEvalPayload } from "./GroupEvalModal";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import type { Group } from "./decisionsQueueTypes";

const AnalysisSummaryModal = dynamic(
  () => import("./DecisionsAnalysisSummaryModal").then((m) => ({ default: m.AnalysisSummaryModal })),
  { loading: () => null }
);
const ScreenWaveModal = dynamic(() => import("./DecisionsScreenWaveModal").then((m) => ({ default: m.ScreenWaveModal })), {
  loading: () => null,
});

export function DecisionsModals({
  summaryEntry, setSummaryEntry, decide,
  evalRole, setEvalRole, evalData, setEvalData, evalCreatedAt, setEvalCreatedAt,
  evalTaskId, setEvalTaskId, evalError, setEvalError, evalGroup, evalDrift,
  openGroupEval, act,
  rulesOpen, setRulesOpen,
  waveRole, setWaveRole, load, setWaveCommsFailed,
}: {
  summaryEntry: Entry | null;
  setSummaryEntry: (e: Entry | null) => void;
  decide: (e: Entry, action: "accept" | "reject", detail?: string) => void;
  evalRole: { roleKey: string; roleTitle: string } | null;
  setEvalRole: (v: { roleKey: string; roleTitle: string } | null) => void;
  evalData: GroupEvalPayload | null;
  setEvalData: (v: GroupEvalPayload | null) => void;
  evalCreatedAt: string | null;
  setEvalCreatedAt: (v: string | null) => void;
  evalTaskId: string | null;
  setEvalTaskId: (v: string | null) => void;
  evalError: string | null;
  setEvalError: (v: string | null) => void;
  evalGroup: Group | null;
  evalDrift: number;
  openGroupEval: (g: Group, rerun?: boolean, selection?: string[]) => void;
  act: (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string, ttlDays?: number) => void;
  rulesOpen: boolean;
  setRulesOpen: (v: boolean) => void;
  waveRole: { jobId: string; title: string } | null;
  setWaveRole: (v: { jobId: string; title: string } | null) => void;
  load: () => void;
  setWaveCommsFailed: (updater: (prev: { count: number; labels: string[] }[]) => { count: number; labels: string[] }[]) => void;
}) {
  return (
    <>
      {summaryEntry ? (
        <AnalysisSummaryModal
          entry={summaryEntry}
          onClose={() => setSummaryEntry(null)}
          onAccept={(reason) => decide(summaryEntry, "accept", reason)}
          onReject={(reason) => decide(summaryEntry, "reject", reason)}
        />
      ) : null}

      {evalRole ? (
        <GroupEvalModal
          roleTitle={evalRole.roleTitle}
          evaluation={evalData}
          loading={evalTaskId !== null}
          error={evalError}
          createdAt={evalCreatedAt}
          poolDrift={evalDrift}
          onClose={() => {
            setEvalRole(null);
            setEvalData(null);
            setEvalCreatedAt(null);
            setEvalTaskId(null);
            setEvalError(null);
          }}
          onRerun={() => {
            if (!evalGroup) return;
            // selection-memory-rerun — replay the original explicit selection when this
            // eval was selection-launched (payload.selection present + persisted
            // comparedIds). openGroupEval filters those ids against the CURRENT cohort, so
            // members who left are dropped; the server re-validates membership + cap and
            // compares the survivors (falling back to top-N when fewer than a comparable
            // pair survive). A default top-N eval (no selection) simply re-runs as top-N.
            const savedSelection = evalData?.selection != null ? evalData?.comparedIds : undefined;
            void openGroupEval(evalGroup, true, savedSelection);
          }}
          onDecide={(identity, action) => {
            // Resolve the eval candidate back to the live pipeline entry by stable id
            // (candIdentity = entry id, label fallback), then reuse act() — same
            // expectedStage CAS + comms as the queue. Resolving by id prevents an
            // irreversible advance/reject from landing on the wrong same-named candidate;
            // the label fallback keeps evals saved before entryId existed working. Acts
            // only on still-pending entries (a candidate decided elsewhere has left
            // evalGroup.entries).
            const e =
              evalGroup?.entries.find((x) => x.id === identity) ??
              evalGroup?.entries.find((x) => x.candidateLabel === identity);
            // Report back whether we found a live entry: a candidate who already left
            // the pool returns false so the modal won't show a fake "Advanced/Rejected".
            if (!e) return false;
            void act(e, action);
            return true;
          }}
        />
      ) : null}

      {rulesOpen ? <DecisionRulesModal onClose={() => setRulesOpen(false)} /> : null}

      {waveRole ? (
        <ScreenWaveModal
          jobId={waveRole.jobId}
          roleTitle={waveRole.title}
          onClose={() => setWaveRole(null)}
          onCommitted={(summary) => {
            load();
            if (summary && summary.commsFailures > 0) {
              // One group PER committed wave — the banner groups + caps names rather
              // than appending an ever-growing flat list. Named labels may be fewer
              // than the count (some failures are anonymous); count carries the total.
              setWaveCommsFailed((prev) => [...prev, { count: summary.commsFailures, labels: summary.failedLabels }]);
            }
          }}
        />
      ) : null}
    </>
  );
}

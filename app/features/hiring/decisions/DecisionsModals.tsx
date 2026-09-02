"use client";

// Modal wiring for the Decisions tab: the analysis-summary modal, the
// group-eval modal, the rules modal and the screening-wave modal. Split out
// of DecisionsTab so that shell stays under the 200-line cap. The two heavy
// modals (analysis summary, screen wave) load as separate chunks — see the
// Tier 3 note in DecisionsTab.tsx / docs/design/loading-choreography.md.
import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { DecisionRulesModal } from "./DecisionsRulesModal";
import { DecisionsGroupEvalRejectModal } from "./DecisionsGroupEvalRejectModal";
import { GroupEvalModal, type GroupEvalPayload } from "./GroupEvalModal";
import type { GovernanceCacheMismatch } from "./groupEval/governanceCacheSync";
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
  evalGovernanceMismatch,
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
  evalGovernanceMismatch?: GovernanceCacheMismatch | null;
  openGroupEval: (g: Group, rerun?: boolean, selection?: string[]) => void;
  act: (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string, ttlDays?: number) => void;
  rulesOpen: boolean;
  setRulesOpen: (v: boolean) => void;
  waveRole: { jobId: string; title: string } | null;
  setWaveRole: (v: { jobId: string; title: string } | null) => void;
  load: () => void;
  setWaveCommsFailed: (updater: (prev: { count: number; labels: string[] }[]) => { count: number; labels: string[] }[]) => void;
}) {
  const tGroupEval = useTranslations("decisions.groupEval");
  // UAT LUC-GEF-L1-08 — the reject awaiting its rationale + confirmation, and the
  // identities whose reject was sealed THIS sitting. The second set exists because
  // the confirm is asynchronous to the click: onDecide has to answer "did this
  // land?" synchronously, so the first click answers `false` (nothing is decided
  // until the rationale is confirmed) and a later click on the same candidate
  // answers `true` from here — the outcome the tab shows is then the truth, and
  // the button is no longer a dead click once the entry has left the live pool.
  const [rejectPending, setRejectPending] = useState<{ entry: Entry; identity: string } | null>(null);
  const [sealedRejects, setSealedRejects] = useState<ReadonlySet<string>>(new Set());
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
          // UAT LUC-GEF-L1-08 — a reject confirmed in the rationale dialog lands
          // AFTER onDecide returned false, so the comparison's own session map never
          // learns about it and would keep live buttons over a rejected candidate.
          // Hand it the seals so the outcome pill is right on the first confirm
          // rather than on a second click.
          sealed={Object.fromEntries([...sealedRejects].map((id) => [id, "reject" as const]))}
          roleTitle={evalRole.roleTitle}
          evaluation={evalData}
          loading={evalTaskId !== null}
          error={evalError}
          createdAt={evalCreatedAt}
          poolDrift={evalDrift}
          governanceMismatch={evalGovernanceMismatch}
          onClose={() => {
            setEvalRole(null);
            setEvalData(null);
            setEvalCreatedAt(null);
            setEvalTaskId(null);
            setEvalError(null);
            // Never leave a confirm dialog (or a session's sealed-reject memory)
            // orphaned behind a closed comparison.
            setRejectPending(null);
            setSealedRejects(new Set());
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
            // UAT LUC-GEF-L1-08 (recurrence 2) — a reject does NOT act here. It used
            // to call act(e, "reject") with no `detail`, so the sealed record fell back
            // to "Recruiter reject from <stage>." and the auditor's Odůvodnění column
            // recorded a tautology, while the analysis path (onReject above) has always
            // passed the recruiter's reason. A reject now routes through the confirm
            // dialog that makes the rationale mandatory; only the ADVANCE half still
            // decides on the click.
            if (action === "reject" && sealedRejects.has(identity)) return true;
            const e =
              evalGroup?.entries.find((x) => x.id === identity) ??
              evalGroup?.entries.find((x) => x.candidateLabel === identity);
            // Report back whether we found a live entry: a candidate who already left
            // the pool returns false so the modal won't show a fake "Advanced/Rejected".
            if (!e) return false;
            if (action === "reject") {
              setRejectPending({ entry: e, identity });
              return false; // nothing is decided until the rationale is confirmed
            }
            void act(e, action);
            return true;
          }}
        />
      ) : null}

      {/* UAT LUC-GEF-L1-08 — stacked over the full-size comparison (Modal portals to
          body and useDialogA11y stacks Escape), so the recruiter never loses the
          context they are deciding in. */}
      {rejectPending ? (
        <DecisionsGroupEvalRejectModal
          candidateLabel={rejectPending.entry.candidateLabel}
          roleTitle={evalRole?.roleTitle}
          onCancel={() => setRejectPending(null)}
          onConfirm={(reason) => {
            const { entry, identity } = rejectPending;
            // The one line this whole item is about: the rationale reaches act() as
            // `detail`, so the sealed record's rationale is the recruiter's basis
            // instead of pipeline-entry-action's "Recruiter reject from <stage>."
            void act(entry, "reject", reason);
            setSealedRejects((s) => new Set(s).add(identity));
            setRejectPending(null);
            // The comparison tab cannot flip to its outcome pill from out here (the
            // decided map is the modal's own session state), so confirm the seal
            // where the recruiter is looking. Truthful wording: the rationale IS
            // recorded synchronously with the request; the candidate's notice is
            // queued by dispatchRejection and is not claimed as delivered.
            toast.success(tGroupEval("rejectConfirm.sealedToast", { name: entry.candidateLabel }));
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

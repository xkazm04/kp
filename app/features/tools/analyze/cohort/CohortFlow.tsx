"use client";

// The role-first flow over the real routes: 1 pick a role, 2 shape who is compared and start,
// 3 the comparison drawn live in the chosen world. The recent strip reopens any earlier
// comparison without re-running it. The step is remembered for this visit (module memory, not
// the URL — the URL is an inbox), so leaving the tab mid-run and coming back finds the run.
//
// The walkthrough runs this same flow against fixture data (CohortWalkthrough provides the
// source): it passes its own compare step (the simulated run), draws no recent strip (that is
// the real install's history), marks the call sheet as fixture data, and always starts at the
// role — its runs live only as long as the walkthrough is mounted.
import { useCallback, useState, type ReactNode } from "react";
import type { CohortRunRequest, CohortStatus, CohortVariant } from "./cohortTypes";
import type { StudioAct, StudioStep } from "./cohortShell";
import { CohortSlate } from "./CohortSlate";
import { CohortRecentStrip } from "./CohortRecentStrip";
import { CohortRolePicker } from "./CohortRolePicker";
import { CohortCastStep } from "./CohortCastStep";
import { CohortCompareStep } from "./CohortCompareStep";

type Facts = { castCount: number | null; status: CohortStatus | null; roleTitle: string | null };
const START: { step: StudioStep; facts: Facts } = { step: { act: "role" }, facts: { castCount: null, status: null, roleTitle: null } };
let remembered = START;

/** The walkthrough's compare step, drawn in place of the live one. */
export type WalkthroughCompare = (props: {
  cohortId: string;
  onStatus: (status: CohortStatus, castCount: number, roleTitle: string) => void;
  onStartOver: () => void;
}) => ReactNode;

export function CohortFlow({ variant, walkthrough = null }: { variant: Exclude<CohortVariant, "v1">; walkthrough?: WalkthroughCompare | null }) {
  // Only the live flow is remembered across visits; the walkthrough starts at the role.
  const remember = walkthrough === null;
  const [step, setStepState] = useState<StudioStep>(remember ? remembered.step : START.step);
  const [facts, setFactsState] = useState<Facts>(remember ? remembered.facts : START.facts);
  const [recentRev, setRecentRev] = useState(0);

  const go = useCallback(
    (next: StudioStep, nextFacts: Partial<Facts>) => {
      setStepState(next);
      setFactsState((prev) => {
        const merged = { ...prev, ...nextFacts };
        if (remember) remembered = { step: next, facts: merged };
        return merged;
      });
    },
    [remember]
  );
  const noteFacts = useCallback(
    (f: Partial<Facts>) => {
      setFactsState((prev) => {
        const merged = { ...prev, ...f };
        if (merged.castCount === prev.castCount && merged.status === prev.status && merged.roleTitle === prev.roleTitle) return prev;
        if (remember) remembered = { ...remembered, facts: merged };
        return merged;
      });
    },
    [remember]
  );

  const onCount = useCallback((castCount: number) => noteFacts({ castCount }), [noteFacts]);
  const onStatus = useCallback(
    (status: CohortStatus, castCount: number, roleTitle: string) => noteFacts({ status, castCount, roleTitle }),
    [noteFacts]
  );
  const pickRole = (jdSlug: string, jdTitle: string) => go({ act: "cast", jdSlug, jdTitle }, { roleTitle: jdTitle, castCount: null, status: null });
  const started = useCallback(
    (cohortId: string, request: CohortRunRequest, jdTitle: string) => {
      setRecentRev((n) => n + 1);
      go({ act: "compare", cohortId, from: { jdSlug: request.jdSlug, jdTitle } }, { castCount: request.members.length, status: "queued", roleTitle: jdTitle });
    },
    [go]
  );
  const reopen = (cohortId: string, jdSlug: string, jdTitle: string, memberCount: number, status: CohortStatus) =>
    go({ act: "compare", cohortId, from: { jdSlug, jdTitle } }, { castCount: memberCount, status, roleTitle: jdTitle });
  // A comparison that finished while drawn changes the strip's status/leader: re-read it once.
  const settled = useCallback(() => setRecentRev((n) => n + 1), []);

  const reachable: StudioAct[] = step.act === "role" ? [] : step.act === "cast" ? ["role"] : step.from ? ["role", "cast"] : ["role"];
  const onAct = (act: StudioAct) => {
    if (act === "role") go({ act: "role" }, { roleTitle: null, castCount: null, status: null });
    else if (act === "cast" && step.act === "compare" && step.from) go({ act: "cast", ...step.from }, { castCount: null, status: null });
  };

  return (
    <>
      <CohortSlate
        step={step}
        roleTitle={facts.roleTitle}
        castCount={facts.castCount}
        status={facts.status}
        fixture={walkthrough ? "walkthrough" : null}
        reachable={reachable}
        onAct={onAct}
      />
      {walkthrough ? null : <CohortRecentStrip rev={recentRev} activeId={step.act === "compare" ? step.cohortId : null} onOpen={reopen} />}
      {step.act === "role" ? <CohortRolePicker onPick={pickRole} /> : null}
      {step.act === "cast" ? (
        <CohortCastStep
          key={step.jdSlug}
          jdSlug={step.jdSlug}
          onCount={onCount}
          onStarted={(id, req) => started(id, req, step.jdTitle)}
          onBack={() => onAct("role")}
        />
      ) : null}
      {step.act === "compare" && walkthrough ? walkthrough({ cohortId: step.cohortId, onStatus, onStartOver: () => onAct("role") }) : null}
      {step.act === "compare" && !walkthrough ? (
        <CohortCompareStep
          key={step.cohortId}
          cohortId={step.cohortId}
          variant={variant}
          onStatus={onStatus}
          onSettled={settled}
          onRestarted={(id, req, jdTitle) => started(id, req, jdTitle)}
        />
      ) : null}
    </>
  );
}

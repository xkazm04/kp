"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { draftParagraphs, pinNotes } from "../logic/galley";
import type { ReviewNote } from "../logic/reviewNote";
import type { SourceRow } from "../logic/wire";
import type { Doubt } from "../shared/doubts";
import { useLintText } from "../shared/useLintText";
import { Galley } from "./Galley";
import { ProofSlip, type SlipTarget } from "./ProofSlip";
import { revealSoon } from "./report/parts";
import type { DeskMemory, DeskStore } from "./signoff/GigsSignoff";

// The report's draft section (report/GigReport.tsx): the proof slip (what to doubt, in words)
// above the galley (the draft as it would be sent, every note pinned beside its paragraph). On the desk the slip carries the
// seen marks, kept in the desk memory with the checklist ticks and the note.

/** The desk memory for an attempt on the desk: kept in the tab's store, so going back and
 *  returning finds the ticks, the seen marks and the note where they were left. A different
 *  attempt remounts the page (GigsTab keys it by gig AND attempt), so the memory never
 *  outlives its draft. */
export function useDeskMemory(attempt: GigAttempt | null, onDesk: boolean, store: DeskStore) {
  const [memory, setMemoryState] = useState<DeskMemory | null>(() => {
    if (!attempt || !onDesk) return null;
    return store.get(attempt.id) ?? { ticks: { ...(attempt.review?.checklist ?? {}) }, seen: [], note: "", startedAt: Date.now() };
  });
  const setMemory = useCallback(
    (update: (m: DeskMemory) => DeskMemory) =>
      setMemoryState((m) => {
        if (!m) return m;
        const next = update(m);
        if (attempt) store.set(attempt.id, next);
        return next;
      }),
    [attempt, store]
  );
  // Kept in the store from the first render, so the review timer survives a trip back.
  useEffect(() => {
    if (attempt && memory) store.set(attempt.id, memory);
  }, [attempt, memory, store]);
  return { memory, setMemory };
}

/** The draft's paragraphs and the notes pinned beside them (and the ones that quote nothing). */
export function usePinned(draft: string, findings: readonly DraftLintFinding[], note: ReviewNote | null) {
  const paras = useMemo(() => draftParagraphs(draft), [draft]);
  const { pinned, loose } = useMemo(() => pinNotes(paras, findings, note && note.header ? note : null), [paras, findings, note]);
  return { paras, pinned, loose };
}

/** A slip link brings its target in: the draft and the evidence are sections of the same
 *  report, so the Summary tab is shown (it usually is), then a margin note takes focus or an
 *  evidence row is marked. */
export function useSlipJump(showReport: () => void) {
  return useCallback(
    (target: SlipTarget) => {
      showReport();
      if (target.kind === "evidence") revealSoon(`gd-ev-${target.n}`, "mark", "center");
      else revealSoon(`gd-note-${target.key}`, "focus", "center");
    },
    [showReport]
  );
}

export function DraftTab({
  gig,
  attempt,
  source,
  specialistName,
  now,
  doubts,
  note,
  pinned: { paras, pinned, loose },
  memory,
  setMemory,
  onJump,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  specialistName: string | null;
  now: Date;
  doubts: readonly Doubt[];
  note: ReviewNote | null;
  pinned: ReturnType<typeof usePinned>;
  memory: DeskMemory | null;
  setMemory: (update: (m: DeskMemory) => DeskMemory) => void;
  onJump: (target: SlipTarget) => void;
}) {
  const t = useTranslations("gigs");
  const lintText = useLintText();
  const seen = useMemo(() => new Set(memory?.seen ?? []), [memory]);
  const pinnedKeyOf = (findingId: string) => pinned.find((n) => n.finding?.id === findingId)?.key ?? null;
  const carried = attempt?.revisionNote ?? null;
  return (
    <>
      {memory ? (
        <ProofSlip
          doubts={doubts}
          pinnedKeyOf={pinnedKeyOf}
          pinnedCount={pinned.length}
          loose={loose}
          seen={seen}
          onSeen={(ids, value) => setMemory((m) => ({ ...m, seen: value ? [...new Set([...m.seen, ...ids])] : m.seen.filter((x) => !ids.includes(x)) }))}
          onJump={onJump}
          carriedNote={carried}
        />
      ) : doubts.length ? (
        <ProofSlip doubts={doubts} pinnedKeyOf={() => null} pinnedCount={0} loose={[]} seen={new Set()} onSeen={() => {}} onJump={onJump} carriedNote={carried} />
      ) : null}
      <Galley gig={gig} attempt={attempt} source={source} specialistName={specialistName} now={now} paras={paras} pinned={pinned} lintText={lintText} reviewBy={note?.byAgent ? t("proof.reviewerAgent") : t("proof.reviewer")} />
    </>
  );
}

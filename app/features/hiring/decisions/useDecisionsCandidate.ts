"use client";

// The candidate modal, opened FROM the decisions ledger: which recommendation is
// open, the cohort its pager walks (the visible reviews, in ledger order), and the
// decision chrome the modal renders (candidate/decision/). The same modal the board
// mounts — one experience of a candidate — with the verdict attached.
//
// CX S46: the role overview opens people with NO recommendation waiting too. Those open the
// same modal without a verdict (its own footer carries the human-gated stage actions) and
// stay open while the person is still on the board's read; a person opened FROM the queue
// keeps the old rule (a verdict that lands elsewhere closes the modal).

import { useCallback, useMemo, useState } from "react";
import type { Entry as PipelineEntry } from "@/app/features/shared/pipelineTypes";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { nextCandidateView, type CandidateTab, type CandidateView } from "../pipeline/candidate/candidateView";
import type { CandidateDecision } from "../pipeline/candidate/decision/candidateDecision";
import type { JobPeerContext, PeerScore } from "./decisionsPeerCompare";
import { armDecision } from "./useDecisionCommitWindow";

// A decisions Entry is a Pick<> of the board entry and both come off the SAME
// GET /api/pipeline row, so at runtime the value already carries every field the
// modal reads — the cast widens the static view back to the wire shape.
const asBoardEntry = (e: Entry): PipelineEntry => e as PipelineEntry;

export function useDecisionsCandidate({
  visibleAiReviews,
  entries,
  act,
  staleSinceOf,
  peersOf,
  peerFactsOf,
}: {
  visibleAiReviews: Entry[];
  /** Every entry the board read (the queue is a subset); null before the first read. */
  entries: Entry[] | null;
  act: (e: Entry, action: "accept" | "reject", detail?: string, ttlDays?: number) => Promise<boolean>;
  staleSinceOf: (e: Entry) => string | null;
  peersOf: (e: Entry) => PeerScore[];
  peerFactsOf: (e: Entry) => JobPeerContext | null;
}) {
  const [view, setView] = useState<CandidateView | null>(null);
  const [busy, setBusy] = useState(false);
  // Opened from outside the queue (no recommendation waited): kept open on the board's read.
  const [plain, setPlain] = useState(false);
  const cohort = useMemo(() => visibleAiReviews.map(asBoardEntry), [visibleAiReviews]);

  const open = useCallback(
    (e: Entry) => {
      setPlain(!visibleAiReviews.some((x) => x.id === e.id));
      setView((prev) => nextCandidateView(prev, asBoardEntry(e), { cohort: null, tab: "overview" }));
    },
    [visibleAiReviews],
  );
  const close = useCallback(() => setView(null), []);
  const navigate = useCallback((e: PipelineEntry) => setView((prev) => nextCandidateView(prev, e)), []);
  const setTab = useCallback((tab: CandidateTab) => setView((prev) => (prev ? { ...prev, tab } : prev)), []);
  const openById = useCallback(
    (id: string) => {
      const e = visibleAiReviews.find((x) => x.id === id) ?? (plain ? entries?.find((x) => x.id === id) : undefined);
      if (e) setView((prev) => nextCandidateView(prev, asBoardEntry(e)));
    },
    [visibleAiReviews, entries, plain],
  );

  // The open recommendation, re-read from the live queue so a decision that landed
  // elsewhere (another window, the batch bar) closes the modal instead of offering
  // a verdict on a row the server already moved.
  const current = view ? (visibleAiReviews.find((e) => e.id === view.entry.id) ?? null) : null;
  const decide = useCallback(
    async (e: Entry, action: "accept" | "reject", ttlDays?: number) => {
      // decisions-review-ui/B — a reject is not written on the click: it arms the
      // shared commit window (the ledger's undo strip counts it down and offers Undo)
      // and the modal closes, exactly as a landed verdict closes it. An accept keeps
      // the immediate write: its handoff (Schedule, interview prep, an offer's secure
      // link) is act()'s to apply, and a forward move is not the emailed, sealed,
      // terminal act the window exists for.
      if (action === "reject") {
        armDecision({ entryId: e.id, action, label: e.candidateLabel, expectedStage: e.stage });
        setView(null);
        return;
      }
      setBusy(true);
      try {
        const ok = await act(e, action, undefined, ttlDays);
        if (ok) setView(null);
      } finally {
        setBusy(false);
      }
    },
    [act],
  );
  const decision: CandidateDecision | null = current
    ? {
        entry: current,
        staleSince: staleSinceOf(current),
        peers: peersOf(current),
        peerFacts: peerFactsOf(current),
        onAccept: (ttlDays) => void decide(current, "accept", ttlDays),
        onReject: () => void decide(current, "reject"),
        busy,
      }
    : null;

  const onBoard = view && plain ? (entries ?? []).some((e) => e.id === view.entry.id) : false;
  return { view: view && (current || onBoard) ? view : null, cohort, decision, open, close, navigate, setTab, openById };
}

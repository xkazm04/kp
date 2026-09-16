"use client";

// THE BRIDGE from a ranked row to the candidate modal.
//
// The ranked pool and the pipeline board speak different nouns. A row here is a
// CANDIDATE (a saved profile or a saved CV analysis, scored against this role);
// `CandidateModal` is built around a pipeline ENTRY — its tabs, its pager and its
// footer actions all key off `entry.id`. The route already answers which of the two
// a row is: it decorates each candidate with `inPipeline`, the stage of that
// candidate's ACTIVE entry for this job (null when there is none).
//
// So the bridge is two doors, and the row's own data picks one:
//
//   inPipeline != null  ->  the real CandidateModal, on that candidate's entry for
//                           THIS role. The entry is looked up in GET /api/pipeline,
//                           fetched ONCE per mount and cached here — the same payload
//                           the board renders, which also carries the stage `axis` the
//                           modal needs, so one request answers both questions and no
//                           route had to change.
//   inPipeline == null  ->  CandidatePreviewModal (beside this file): the honest
//                           read-only pre-pipeline view, with the two sourcing actions
//                           the old cards carried. A candidate with no entry has no
//                           stage, no timeline and no decision to rule on, and opening
//                           the entry modal on a synthesized entry would invent all
//                           three.
//
// A lookup that finds nothing (the entry was closed or moved between the ranking and
// the click) falls back to the preview rather than to a broken modal.

import { useCallback, useRef, useState } from "react";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { nextCandidateView, type CandidateTab, type CandidateView } from "@/app/features/hiring/pipeline/candidate/candidateView";
import type { CandRow } from "../JobsTypes";

type BoardPayload = { entries?: Entry[]; stages?: StageDef[] };

export function useCandidateBridge(jobId: string) {
  const [view, setView] = useState<CandidateView | null>(null);
  const [axis, setAxis] = useState<readonly StageDef[]>(DEFAULT_STAGE_AXIS);
  const [preview, setPreview] = useState<CandRow | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  // One board read per mount, shared by every row that needs it. A ref, not state:
  // the promise is a cache, and re-rendering on its arrival is what `view` is for.
  const boardRef = useRef<Promise<BoardPayload> | null>(null);

  const readBoard = useCallback(async (): Promise<BoardPayload> => {
    if (!boardRef.current) {
      boardRef.current = fetch("/api/pipeline")
        .then((r) => (r.ok ? (r.json() as Promise<BoardPayload>) : {}))
        .catch(() => {
          // A blip must not poison the cache: drop it so the next click retries.
          boardRef.current = null;
          return {} as BoardPayload;
        });
    }
    return boardRef.current;
  }, []);

  /** Open whichever door this candidate's data earns. */
  const open = useCallback(
    async (c: CandRow) => {
      if (!c.inPipeline) {
        setPreview(c);
        return;
      }
      setOpening(c.candidateId);
      try {
        const board = await readBoard();
        const entry = (board.entries ?? []).find(
          (e) => e.candidateId === c.candidateId && e.jobId === jobId && e.status === "active",
        );
        if (board.stages && board.stages.length > 0) setAxis(board.stages);
        if (entry) setView((prev) => nextCandidateView(prev, entry, { cohort: null, tab: "overview" }));
        // The ranking said "in pipeline" and the board disagrees: the entry moved
        // or closed since. Show what we DO know rather than an empty modal.
        else setPreview(c);
      } finally {
        setOpening(null);
      }
    },
    [jobId, readBoard],
  );

  const close = useCallback(() => setView(null), []);
  const closePreview = useCallback(() => setPreview(null), []);
  const navigate = useCallback((entry: Entry) => setView((prev) => nextCandidateView(prev, entry)), []);
  const setTab = useCallback((tab: CandidateTab) => setView((prev) => (prev ? { ...prev, tab } : prev)), []);
  /** The modal's in-place refresh (a stage move) and its rematch links. */
  const openEntryById = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/pipeline/${encodeURIComponent(id)}`);
        if (!r.ok) return;
        const d = (await r.json()) as { entry?: Entry };
        if (d?.entry) setView((prev) => nextCandidateView(prev, d.entry as Entry));
      } catch {
        /* network blip — leave the modal on the entry it already shows */
      }
    },
    [],
  );
  /** A stage move behind the modal invalidates the cached board read. */
  const invalidate = useCallback(() => {
    boardRef.current = null;
  }, []);

  return { view, axis, preview, opening, open, close, closePreview, navigate, setTab, openEntryById, invalidate };
}

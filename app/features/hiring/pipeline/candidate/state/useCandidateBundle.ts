"use client";

// The candidate's whole story in ONE request: GET /api/pipeline/[id]/timeline carries
// the pipeline events, the cross-store timeline items (analyses, interview, invites,
// offer), the full comms letters with their DERIVED delivery verdict, the latest
// interview outcome, the human scorecard, the GDPR consent snapshot, the sealed
// decision trail, the staleness instant and the server-truth recruiter note. It
// replaced five independent fetches.
//
// The story knows it can go stale (candidateBundle.ts): `invalidate()` re-pulls it
// after an in-modal write, a stage move re-pulls it, and every re-pull keeps the
// last-good story painted (stale-while-revalidate). Only a FIRST-load failure leaves
// nothing to show - `bundleFailed` - and `retry()` is its way out.

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useTranslations } from "next-intl";
import type { CandidateTimelineItem, RematchLink } from "@/app/_lib/candidate-timeline";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";
import { bundleReducer, consentFailed, initialBundleState, parseCandidateBundle } from "./candidateBundle";

export type { InterviewOutcome } from "./candidateBundle";

export type HistoryRow =
  | { at: string; key: string; type: "event"; ev: PipelineEvent }
  | { at: string; key: string; type: "extra"; item: CandidateTimelineItem };

const NO_LINKS: Record<number, RematchLink> = {};

export function useCandidateBundle(entry: { id: string; stage: string }) {
  const t = useTranslations("pipeline.drawer");
  const [state, dispatch] = useReducer(bundleReducer, undefined, initialBundleState);
  // single-entry-authz-parity: the bundle is operator-gated, so a 401/403 is named.
  const [timelineErr, setTimelineErr] = useState<string | null>(null);

  // A different candidate drops the previous story; an IN-PLACE stage move (same id,
  // new stage) re-pulls it with the current story still painted - the move event lands
  // in the history and staleSince is recomputed. Adjusted during render, not in an
  // effect, so the previous candidate's story never paints under the new header.
  const [pulledFor, setPulledFor] = useState({ id: entry.id, stage: entry.stage });
  if (pulledFor.id !== entry.id || pulledFor.stage !== entry.stage) {
    setPulledFor({ id: entry.id, stage: entry.stage });
    dispatch(pulledFor.id !== entry.id ? { type: "reset" } : { type: "invalidate" });
  }

  const { seq } = state;
  useEffect(() => {
    let alive = true;
    fetch(`/api/pipeline/${encodeURIComponent(entry.id)}/timeline`)
      .then((r) => {
        // Set inside the async callback (not in the effect body) so it lands after render.
        if (alive) setTimelineErr(r.status === 401 || r.status === 403 ? t("notPermitted") : null);
        return r.ok ? r.json() : null;
      })
      .then((json) => {
        if (!alive) return;
        const data = parseCandidateBundle(json);
        // The reducer drops a response for any seq but the current one, so an older
        // pull can never overwrite a newer story.
        dispatch(data ? { type: "settle", seq, data } : { type: "fail", seq });
      })
      .catch(() => {
        if (alive) dispatch({ type: "fail", seq });
      });
    return () => {
      alive = false;
    };
    // `seq` IS the pull: invalidate, retry, a stage move and a new candidate each
    // issue a new one. `t` is a stable per-namespace binding.
  }, [entry.id, seq, t]);

  // Stable identities: the modal hands these to effects and child props.
  const invalidate = useCallback(() => dispatch({ type: "invalidate" }), []);
  const retry = useCallback(() => dispatch({ type: "retry" }), []);

  const data = state.data;
  // The unified story: pipeline events + the cross-store chapters, time-ordered.
  const mergedHistory = useMemo(() => {
    const rows: HistoryRow[] = [
      ...(data?.events ?? []).map((ev) => ({ at: ev.createdAt, key: `ev-${ev.id}`, type: "event" as const, ev })),
      ...(data?.items ?? []).map((item, i) => ({ at: item.at, key: `tl-${i}`, type: "extra" as const, item })),
    ];
    rows.sort((a, b) => a.at.localeCompare(b.at));
    return rows;
  }, [data]);

  return {
    timelineErr,
    mergedHistory,
    rematchLinks: data?.rematchLinks ?? NO_LINKS,
    staleSince: data?.staleSince ?? null,
    consent: data?.consent ?? null,
    // drawer-comms-truth - the consent panel's "could not load" is a FIRST-load
    // failure only; a failed re-pull keeps the good snapshot (status "stale").
    bundleFailed: consentFailed(state),
    bundleStatus: state.status,
    // null until the bundle lands, so "nothing yet" is said only once it has.
    comms: data ? data.comms : null,
    ivOutcome: data?.interview ?? null,
    humanSc: data?.humanScorecard ?? null,
    decisions: data?.decisions ?? null,
    // drawer-note-fresh-hydration - the note as it stands ON THE SERVER; the board
    // prop that seeds the field can be stale. null until the bundle lands.
    bundleNotes: data ? (data.notes ?? "") : null,
    invalidate,
    retry,
  };
}

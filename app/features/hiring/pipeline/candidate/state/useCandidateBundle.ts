"use client";

// The candidate's whole story in ONE request: GET /api/pipeline/[id]/timeline carries
// the pipeline events, the cross-store timeline items (analyses, interview, invites,
// offer), the full comms letters with their DERIVED delivery verdict, the latest
// interview outcome, the human scorecard, the GDPR consent snapshot, the staleness
// instant and the server-truth recruiter note. It replaced five independent fetches.
// Best-effort: a failed load leaves the sections empty — but SAYS so (see
// `bundleFailed`), because the consent panel cannot tell "loading" from "gave up"
// on a null snapshot alone.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CandidateComm, CandidateConsentView, CandidateTimelineItem, RematchLink } from "@/app/_lib/candidate-timeline";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import type { Scorecard, ScorecardEntities, ScorecardRating } from "@/app/_lib/interview-scorecard";
import type { ScorecardCoverage } from "@/app/_lib/interview-transcript";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";

export type InterviewOutcome = {
  recommendation?: string;
  summary?: string;
  ratings?: ScorecardRating[];
  hasTranscript?: boolean;
  /** Conversation signals + scoring-coverage caveat, projected server-side. Absent ⇒ no chrome. */
  telemetry?: InterviewTelemetry;
  coverage?: ScorecardCoverage;
  /** Structured read-back outcome (confirmed / corrected / unconfirmed technologies). */
  entities?: ScorecardEntities;
};

export type HistoryRow =
  | { at: string; key: string; type: "event"; ev: PipelineEvent }
  | { at: string; key: string; type: "extra"; item: CandidateTimelineItem };

export function useCandidateBundle(entry: { id: string; stage: string }) {
  const t = useTranslations("pipeline.drawer");
  const [history, setHistory] = useState<PipelineEvent[] | null>(null);
  // single-entry-authz-parity: the bundle is operator-gated, so a 401/403 is named.
  const [timelineErr, setTimelineErr] = useState<string | null>(null);
  const [extraTimeline, setExtraTimeline] = useState<CandidateTimelineItem[]>([]);
  // rematch-story-navigable — each re-engagement event's counterpart, resolved
  // server-side, so the history links only to an entry that still exists.
  const [rematchLinks, setRematchLinks] = useState<Record<number, RematchLink>>({});
  // drawer-staleness-parity — the JD's last edit when this entry's score predates it.
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const [consent, setConsent] = useState<CandidateConsentView | null>(null);
  // drawer-comms-truth — the missing third state beside "loading" and "loaded".
  const [bundleFailed, setBundleFailed] = useState(false);
  const [comms, setComms] = useState<CandidateComm[] | null>(null);
  const [ivOutcome, setIvOutcome] = useState<InterviewOutcome | null>(null);
  const [humanSc, setHumanSc] = useState<Scorecard | null>(null);
  // drawer-note-fresh-hydration — the note as it stands ON THE SERVER; the board prop
  // that seeds the field can be stale (notes are not in the board's entry signature).
  const [bundleNotes, setBundleNotes] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/pipeline/${encodeURIComponent(entry.id)}/timeline`)
      .then((r) => {
        // Set inside the async callback (not in the effect body) so it lands after render.
        if (alive) setTimelineErr(r.status === 401 || r.status === 403 ? t("notPermitted") : null);
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (!alive) return;
        if (!d) {
          // A non-OK response: the WHOLE bundle is gone, consent included.
          setHistory([]);
          setBundleFailed(true);
          return;
        }
        setBundleFailed(false);
        setHistory((d.events as PipelineEvent[]) ?? []);
        setBundleNotes((d.notes as string | null | undefined) ?? "");
        setExtraTimeline((d.items as CandidateTimelineItem[]) ?? []);
        setRematchLinks((d.rematchLinks as Record<number, RematchLink> | undefined) ?? {});
        setStaleSince((d.staleSince as string | null | undefined) ?? null);
        setComms((d.comms as CandidateComm[] | undefined) ?? []);
        setIvOutcome((d.interview as InterviewOutcome | null) ?? null);
        setConsent((d.consent as CandidateConsentView | undefined) ?? null);
        // An empty scorecard artifact is noise: keep it only with ratings or a summary.
        const sc = (d.humanScorecard as Scorecard | null) ?? null;
        setHumanSc(sc && (sc.ratings?.length || sc.summary) ? sc : null);
      })
      .catch(() => {
        if (!alive) return;
        setHistory([]);
        setBundleFailed(true);
      });
    return () => {
      alive = false;
    };
    // entry.stage rides the deps so an IN-PLACE stage move (same id, new stage)
    // re-pulls the bundle: the move event lands in the history and staleSince is
    // recomputed. `t` is a stable per-namespace binding.
  }, [entry.id, entry.stage, t]);

  // The unified story: pipeline events + the cross-store chapters, time-ordered.
  const mergedHistory = useMemo(() => {
    const rows: HistoryRow[] = [
      ...(history ?? []).map((ev) => ({ at: ev.createdAt, key: `ev-${ev.id}`, type: "event" as const, ev })),
      ...extraTimeline.map((item, i) => ({ at: item.at, key: `tl-${i}`, type: "extra" as const, item })),
    ];
    rows.sort((a, b) => a.at.localeCompare(b.at));
    return rows;
  }, [history, extraTimeline]);

  return { timelineErr, mergedHistory, rematchLinks, staleSince, consent, bundleFailed, comms, ivOutcome, humanSc, bundleNotes };
}

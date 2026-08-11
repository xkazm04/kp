"use client";

// Opening things FROM the board: the AI-actions drawer (in hand or resolved by id),
// the analyzed profile, the job, the per-position ranking, and Decisions — plus the
// Recent-group bookkeeping each of those "I'm working on this" moments owes the shell.
// Split out of usePipelineTabState.

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { recordRecent } from "@/app/features/shell/recents";
import type { Entry } from "@/app/features/shared/pipelineTypes";

export function usePipelineNavigation({
  entries,
  setDrawerEntry,
}: {
  entries: Entry[] | null;
  setDrawerEntry: (e: Entry | null) => void;
}) {
  // Every destination here is another ?tab= on the SAME route, so it is a URL patch,
  // not a server navigation (shell/nav/shallow-nav.ts). The shell still scrolls to
  // the top of the new tab — its focus-the-<main>-landmark effect does that.
  const nav = useShellNavigate();
  const search = useSearchParams();
  // SHELL3 — opening a candidate/profile/job from the board is the canonical
  // "I'm working on this" moment; record it so the sidebar Recent group and the
  // palette's resting state can resume it after the shell wipes the selection.
  const openActions = (e: Entry) => {
    recordRecent({
      type: "entry",
      id: e.id,
      label: e.candidateLabel,
      href: buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", q: e.candidateLabel }, search.toString()),
    });
    setDrawerEntry(e);
  };
  // rematch-story-navigable / drawer-flow-friction — open a drawer for an entry by id.
  // Unlike openActions (which has the full Entry in hand), this resolves the entry from
  // the server, so it reaches a COUNTERPART entry that may be terminal / off the active
  // board (a rematch link) and also serves the IN-PLACE refresh after a stage move
  // (same id → the keyed drawer re-renders without remounting). A 404 (deleted /
  // other-tenant / raced) is a silent no-op — never a broken drawer.
  const openEntryById = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/pipeline/${encodeURIComponent(id)}`);
        if (!r.ok) return;
        const d = (await r.json()) as { entry?: Entry };
        if (d?.entry) setDrawerEntry(d.entry);
      } catch {
        /* network blip — leave the drawer as-is */
      }
    },
    [setDrawerEntry]
  );
  // Candidate name → the analyzed profile (Match view); falls back to the
  // AI-actions drawer when the entry has no linked candidate id.
  const openProfile = (e: Entry) => {
    if (!e.candidateId) {
      setDrawerEntry(e);
      return;
    }
    const href = buildUrl({ tab: "matrix", profile: e.candidateId }, search.toString());
    recordRecent({ type: "profile", id: e.candidateId, label: e.candidateLabel, href });
    nav.push(href);
  };
  const openJob = (jobId: string) => {
    const href = buildUrl({ tab: "jobs", job: jobId }, search.toString());
    const title = (entries ?? []).find((e) => e.jobId === jobId)?.jobTitle;
    recordRecent({ type: "job", id: jobId, label: title ?? jobId, href });
    nav.push(href);
  };
  // The "awaiting you" stat chip and the approvals banner both jump to Decisions.
  const goToDecisions = () => nav.push(buildUrl({ tab: "decisions" }, search.toString()));
  // "Rank candidates" → the Fit matrix scoped to this position (a per-position ranking).
  const openPositionRanking = (jobId: string) => nav.push(buildUrl({ tab: "matrix", job: jobId }, search.toString()));

  return { openActions, openEntryById, openProfile, openJob, goToDecisions, openPositionRanking };
}

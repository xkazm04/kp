"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { JourneyCohortOutcome } from "@/app/_lib/journey/types";
import { useJourneyBoard } from "../useJourneyBoard";
import { useJourneyCohort } from "../cohort/useJourneyCohort";
import { cohortReach, type KitStep } from "./journeyKitSteps";
import { laneRow, listLanes, NO_LANE_FILTERS, railCohort, railSteps, type LaneFilters } from "./journeyKitModel";

/** A short, stable signature (the pipeline kit's djb2): equal data, equal key, no replay. */
function signature(parts: readonly string[]): string {
  let h = 5381;
  for (const p of parts) for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) | 0;
  return `${parts.length}:${(h >>> 0).toString(36)}`;
}

/** What the reading pane holds: one candidate's journey, or one row of the role's shared band. */
export type PaneTarget = { kind: "lane"; entryId: string } | { kind: "shared"; eventId: string };

/*
 * The lane board's state. Two existing reads: GET /api/journeys/cohort (every role, every journey's
 * kinds and outcome: the Roles section and the status marks) and GET /api/journeys?role=<jobId>
 * (the selected role's columns, rail and shared band: the lanes and the pane). What is new is only
 * the board's own state: the role, the filters, the stop step, the cursor and the open pane.
 */
export function useJourneyKit(initialRole?: string | null) {
  const t = useTranslations("journey");
  const hasKey = useCallback((key: string) => t.has(key as Parameters<typeof t.has>[0]), [t]);
  const cohort = useJourneyCohort();
  const roles = useMemo(() => cohort.cohort?.roles ?? [], [cohort.cohort]);
  const [picked, setPicked] = useState<string | null>(initialRole ?? null);
  const jobId = picked ?? roles[0]?.jobId ?? null;
  const board = useJourneyBoard(jobId ?? undefined, jobId === null);
  const [filters, setFilters] = useState<LaneFilters>(NO_LANE_FILTERS);
  const [observedOnly, setObservedOnly] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pane, setPane] = useState<PaneTarget | null>(null);
  const [now] = useState(() => Date.now());

  const cluster = useMemo(() => board.board?.clusters.find((c) => c.jobId === jobId) ?? null, [board.board, jobId]);
  const outcomes = useMemo(() => {
    const m = new Map<string, JourneyCohortOutcome>();
    for (const i of cohort.cohort?.instances ?? []) m.set(i.id, i.outcome);
    return m;
  }, [cohort.cohort]);
  const lanes = useMemo(
    () => (cluster ? cluster.columns.map((c) => laneRow(c, outcomes.get(c.entryId), { observedOnly, hasKey }, now)) : []),
    [cluster, outcomes, observedOnly, hasKey, now]
  );
  const rail = useMemo(() => railSteps(railCohort(lanes, filters)), [lanes, filters]);
  const rows = useMemo(() => listLanes(lanes, filters), [lanes, filters]);
  const roleRows = useMemo(() => {
    const byRole = new Map<string, NonNullable<typeof cohort.cohort>["instances"]>();
    for (const i of cohort.cohort?.instances ?? []) byRole.set(i.jobId, [...(byRole.get(i.jobId) ?? []), i]);
    return roles.map((r) => {
      const inst = byRole.get(r.jobId) ?? [];
      const last = inst.reduce((m, i) => Math.max(m, ...i.steps.map((s) => Date.parse(s.at) || 0)), 0);
      const needs = inst.filter((i) => (i.outcome === "open" || i.outcome === "stalled") && i.steps.at(-1)?.kind === "screening_hold").length;
      return { role: r, reach: cohortReach(inst), hired: inst.filter((i) => i.outcome === "hired").length, needs, last: last || null };
    });
  }, [cohort, roles]);

  // Motion plays once per role or data change (usePlayOnce / the lane arrival), never on scroll.
  const replayKey = useMemo(() => `${jobId}|${signature(lanes.map((l) => `${l.column.entryId}:${l.furthest}`))}`, [jobId, lanes]);
  const openLane = pane?.kind === "lane" ? (lanes.find((l) => l.column.entryId === pane.entryId) ?? null) : null;
  const index = cursor ? rows.findIndex((l) => l.column.entryId === cursor) : -1;

  const step = (delta: 1 | -1) => {
    if (!rows.length) return;
    const at = index < 0 ? (delta > 0 ? -1 : rows.length) : index;
    const next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))];
    if (!next) return;
    setCursor(next.column.entryId);
    if (pane) setPane({ kind: "lane", entryId: next.column.entryId });
  };

  return {
    // Already localized by the hooks (errors.<CODE> via useErrorMessage): render as they are.
    cohortError: cohort.error,
    boardError: board.error,
    cohort, board, roles, roleRows, jobId, cluster, lanes, rail, rows, filters, observedOnly, cursor, pane, openLane, index, now, hasKey, replayKey,
    resetKey: `${jobId}|${filters.stop}|${filters.activeOnly}|${filters.testRuns}|${filters.find}`,
    pickRole: (id: string) => {
      if (id === jobId) return;
      setPicked(id);
      setFilters((f) => ({ ...f, stop: null }));
      setCursor(null);
      setPane(null);
    },
    setFind: (find: string) => setFilters((f) => ({ ...f, find })),
    toggle: (key: "activeOnly" | "testRuns") => setFilters((f) => ({ ...f, [key]: !f[key] })),
    toggleObserved: () => setObservedOnly((v) => !v),
    toggleStop: (id: KitStep) => setFilters((f) => ({ ...f, stop: f.stop === id ? null : id })),
    select: (entryId: string) => {
      setCursor(entryId);
      setPane({ kind: "lane", entryId });
    },
    openShared: (eventId: string) => setPane({ kind: "shared", eventId }),
    openCursor: () => cursor && setPane({ kind: "lane", entryId: cursor }),
    close: () => setPane(null),
    step,
  };
}

export type JourneyKit = ReturnType<typeof useJourneyKit>;

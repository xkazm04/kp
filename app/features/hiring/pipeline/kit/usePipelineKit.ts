"use client";

import { useMemo, useState } from "react";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { canonicalScoreOf } from "@/app/_lib/match-score";
import { foldOrder } from "@/app/_components/kit/graphic/sieveLayout";
import { entryLaneKey, type Entry } from "@/app/features/shared/pipelineTypes";
import { entryMatchesFilters, sortFilteredEntries } from "../pipelineBoardFilters";
import { groupPositions } from "../pipelineBoardLayout";
import type { PipelineTabState } from "../usePipelineTabState";
import type { KitFilters } from "./useKitFilters";
import { useRejectedShelf } from "./useRejectedShelf";
import { waitingOn } from "./lineAttention";
import { buildLayers, dimmed, listRows, OUT, presets, rankByMatch, sieveDots, type Ctx, type Filters } from "./pipelineKitModel";
import { ALL, resolveRole, roleRows } from "./rolesBoardModel";

/** A short, stable signature for a replay key: equal data, equal key, no replay. */
export function signature(parts: readonly string[]): string {
  let h = 5381;
  for (const p of parts) for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) | 0;
  return `${parts.length}:${(h >>> 0).toString(36)}`;
}

/*
 * The kit view's state over the SAME tab state the pipeline has always read (usePipelineTabState:
 * the board payload, the URL-synced search and facets, the navigation helpers) plus the kit's own
 * narrowing (useKitFilters: layer, role, waiting-only, match brush).
 *
 * Two levels. Level 1 is the roles board (`board`: one row per role, rolesBoardModel), aggregated over
 * the entries the board's filters and the waiting-only chip keep. Level 2 is the picked scope (`role`: a
 * lane key, or ALL) and everything below the board reads it: the Sieve, the Skyline and the list are
 * built from `scoped`, that role's entries alone, so at one role's scale a dot per candidate reads again.
 * The list is filtered by the board's compound predicate (entryMatchesFilters) and the kit's narrowing;
 * the chosen sort then reorders it, "board order" keeping waiting-first-then-match.
 */
export function usePipelineKit(s: PipelineTabState, f: KitFilters) {
  const [pour, setPour] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const entries = useMemo(() => s.entries ?? [], [s.entries]);
  const role = useMemo(() => resolveRole(f.role, entries), [f.role, entries]);
  const lane = role && role !== ALL ? role : null;
  const scoped = useMemo(() => (lane ? entries.filter((e) => entryLaneKey(e) === lane) : entries), [entries, lane]);
  const ctx: Ctx = useMemo(
    () => ({ score: canonicalScoreOf, needs: (e: Entry) => e.status === "active" && needsHumanDecision(e.approvalKind), now }),
    [now]
  );
  const everyone = useMemo(() => rankByMatch(entries, ctx), [entries, ctx]);
  const { ranked, rankOf } = useMemo(() => (lane ? rankByMatch(scoped, ctx) : everyone), [lane, scoped, ctx, everyone]);
  const rejected = useMemo(() => (lane ? { [lane]: s.rejectedByLane[lane] ?? 0 } : s.rejectedByLane), [lane, s.rejectedByLane]);
  const layers = useMemo(() => buildLayers(s.axis, s.retiredStages, scoped, rejected, ctx), [s.axis, s.retiredStages, scoped, rejected, ctx]);
  const dots = useMemo(() => foldOrder(sieveDots(ranked, layers, ctx), (d) => d.rank), [ranked, layers, ctx]);

  const { query, quicks, scoreBands, sources, stageFilter, slaOverrides, axis, sort, plan } = s;
  const { layer, needsOnly, brush } = f;
  const filters: Filters = useMemo(
    () => ({
      query: (e: Entry) => entryMatchesFilters(e, { query, quicks, scoreBands, sources, stage: stageFilter }, { overrides: slaOverrides, axis, now }),
      layer, needsOnly, role: null, brush,
    }),
    [query, quicks, scoreBands, sources, stageFilter, slaOverrides, axis, now, layer, needsOnly, brush]
  );
  // Level 1: the roles the filters keep, counted over the candidates they keep.
  const board = useMemo(() => {
    const kept = entries.filter((e) => (!needsOnly || ctx.needs(e)) && filters.query(e));
    return roleRows(kept, axis, { needs: ctx.needs, ai: (e) => waitingOn(e, axis, plan) === "ai" }, everyone.rankOf);
  }, [entries, needsOnly, ctx, filters, axis, plan, everyone.rankOf]);
  // Rejected rows never ride the board payload: the exit layer lists the rejected shelf, fetched per lane
  // only once that layer is picked (useRejectedShelf), and searched with the same text query.
  const shelf = useRejectedShelf(layer === OUT && role != null, s.rejectedByLane, lane);
  const rows = useMemo(
    () =>
      layer === OUT
        ? shelf.rows.filter((e) => entryMatchesFilters(e, { query, quicks: new Set(), scoreBands: new Set(), sources: new Set(), stage: null }, { axis, now }))
        : sortFilteredEntries(listRows(scoped, filters, rankOf, ctx), sort, { now }),
    [layer, shelf.rows, query, axis, scoped, filters, rankOf, ctx, sort, now]
  );
  const dim = useMemo(() => dimmed(scoped, filters, rankOf, ctx), [scoped, filters, rankOf, ctx]);
  const roles = useMemo(() => groupPositions(entries).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)), [entries]);

  const sieveKey = useMemo(() => `pour${pour}|${role ?? ""}|${signature(scoped.map((e) => `${e.id}:${e.stage}:${e.stageChangedAt ?? ""}`))}`, [pour, role, scoped]);
  const skyKey = useMemo(() => `${role ?? ""}|${signature(ranked.map((e) => `${e.id}:${ctx.score(e) ?? "-"}`))}`, [role, ranked, ctx]);
  const open = selected ? entries.find((e) => e.id === selected) ?? shelf.rows.find((e) => e.id === selected) ?? null : null;
  const index = open ? rows.findIndex((e) => e.id === open.id) : -1;
  const openScope = (scope: string, stage: string | null = null) => {
    setSelected(null);
    f.open(scope, stage);
  };

  return {
    ctx, entries, scoped, ranked, rankOf, layers, dots, rows, dim, roles, board, presets: presets(ranked, ctx), shelf,
    layer, role, lane, needsOnly, brush, sieveKey, skyKey, open, index,
    resetKey: `${f.scope}|${s.visibleScope}`,
    toggleLayer: (id: string) => f.setLayer((cur) => (cur === id ? null : id)),
    clearLayer: () => f.setLayer(null),
    /** A stage from anywhere on the page (Today): open it in the current scope, or across every role. */
    showLayer: (id: string) => openScope(role ?? ALL, id),
    openScope,
    closeScope: () => {
      setSelected(null);
      f.close();
    },
    setBrush: f.setBrush,
    toggleNeeds: () => f.setNeedsOnly((v) => !v),
    reviewWaiting: () => {
      f.setNeedsOnly(true);
      f.setBrush(null);
      openScope(role ?? ALL);
    },
    // The level is not a filter: clearing the filters keeps the scope open.
    clearKitFilters: () => { f.setLayer(null); f.setNeedsOnly(false); f.setBrush(null); },
    pourAgain: () => setPour((p) => p + 1),
    select: (id: string | null) => setSelected(id),
    /** Open a row in the reading pane: the kit's "open a candidate", recorded in the sidebar's Recent. */
    openRow: (id: string) => {
      setSelected(id);
      const e = entries.find((x) => x.id === id) ?? shelf.rows.find((x) => x.id === id);
      if (e) s.recordEntry(e);
    },
    step: (delta: 1 | -1) => {
      if (!rows.length) return;
      const at = index < 0 ? (delta > 0 ? -1 : rows.length) : index;
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))];
      if (next) setSelected(next.id);
    },
  };
}

export type PipelineKit = ReturnType<typeof usePipelineKit>;

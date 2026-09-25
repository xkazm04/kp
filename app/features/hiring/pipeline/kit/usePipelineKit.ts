"use client";

import { useMemo, useState } from "react";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { canonicalScoreOf } from "@/app/_lib/match-score";
import { foldOrder } from "@/app/_components/kit/graphic/sieveLayout";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { entryMatchesFilters, sortFilteredEntries } from "../pipelineBoardFilters";
import type { PipelineTabState } from "../usePipelineTabState";
import type { KitFilters } from "./useKitFilters";
import { buildLayers, dimmed, listRows, OUT, presets, rankByMatch, sieveDots, type Ctx, type Filters } from "./pipelineKitModel";

/** A short, stable signature for a replay key: equal data, equal key, no replay. */
export function signature(parts: readonly string[]): string {
  let h = 5381;
  for (const p of parts) for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) | 0;
  return `${parts.length}:${(h >>> 0).toString(36)}`;
}

/*
 * The kit view's state over the SAME tab state the pipeline has always read (usePipelineTabState:
 * the board payload, the URL-synced search and facets, the navigation helpers) plus the kit's own
 * narrowing (useKitFilters: layer, role, waiting-only, match brush). The list is filtered by BOTH:
 * the board's compound predicate (entryMatchesFilters: query, stage deep link, quicks, score bands,
 * sources, with the team's SLA cadences) and the kit's; the chosen sort then reorders it, "board
 * order" keeping the kit's waiting-first-then-match order.
 */
export function usePipelineKit(s: PipelineTabState, f: KitFilters) {
  const [pour, setPour] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const entries = useMemo(() => s.entries ?? [], [s.entries]);
  const ctx: Ctx = useMemo(
    () => ({ score: canonicalScoreOf, needs: (e: Entry) => e.status === "active" && needsHumanDecision(e.approvalKind), now }),
    [now]
  );
  const { ranked, rankOf } = useMemo(() => rankByMatch(entries, ctx), [entries, ctx]);
  const layers = useMemo(
    () => buildLayers(s.axis, s.retiredStages, entries, s.rejectedByLane, ctx),
    [s.axis, s.retiredStages, entries, s.rejectedByLane, ctx]
  );
  const dots = useMemo(() => foldOrder(sieveDots(ranked, layers, ctx), (d) => d.rank), [ranked, layers, ctx]);

  const { query, quicks, scoreBands, sources, stageFilter, slaOverrides, axis, sort } = s;
  const { layer, needsOnly, role, brush } = f;
  const filters: Filters = useMemo(
    () => ({
      query: (e: Entry) => entryMatchesFilters(e, { query, quicks, scoreBands, sources, stage: stageFilter }, { overrides: slaOverrides, axis, now }),
      layer, needsOnly, role, brush,
    }),
    [query, quicks, scoreBands, sources, stageFilter, slaOverrides, axis, now, layer, needsOnly, role, brush]
  );
  // Rejected rows are counted on the exit layer but never on the board payload: that layer lists nobody.
  const rows = useMemo(
    () => (layer === OUT ? [] : sortFilteredEntries(listRows(entries, filters, rankOf, ctx), sort, { now })),
    [layer, entries, filters, rankOf, ctx, sort, now]
  );
  const dim = useMemo(() => dimmed(entries, filters, rankOf, ctx), [entries, filters, rankOf, ctx]);
  const roles = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) if (e.jobTitle) m.set(e.jobTitle, (m.get(e.jobTitle) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entries]);

  const sieveKey = useMemo(() => `pour${pour}|${signature(entries.map((e) => `${e.id}:${e.stage}:${e.stageChangedAt ?? ""}`))}`, [pour, entries]);
  const skyKey = useMemo(() => signature(ranked.map((e) => `${e.id}:${ctx.score(e) ?? "-"}`)), [ranked, ctx]);
  const open = selected ? entries.find((e) => e.id === selected) ?? null : null;
  const index = open ? rows.findIndex((e) => e.id === open.id) : -1;

  return {
    ctx, entries, ranked, rankOf, layers, dots, rows, dim, roles, presets: presets(ranked, ctx),
    layer, role, needsOnly, brush, sieveKey, skyKey, open, index,
    resetKey: `${f.scope}|${s.visibleScope}`,
    toggleLayer: (id: string) => f.setLayer((cur) => (cur === id ? null : id)),
    clearLayer: () => f.setLayer(null),
    setRole: f.setRole, setBrush: f.setBrush,
    toggleNeeds: () => f.setNeedsOnly((v) => !v),
    reviewWaiting: () => { f.setNeedsOnly(true); f.setLayer(null); f.setBrush(null); },
    clearKitFilters: () => { f.setLayer(null); f.setRole(null); f.setNeedsOnly(false); f.setBrush(null); },
    pourAgain: () => setPour((p) => p + 1),
    select: (id: string | null) => setSelected(id),
    step: (delta: 1 | -1) => {
      if (!rows.length) return;
      const at = index < 0 ? (delta > 0 ? -1 : rows.length) : index;
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))];
      if (next) setSelected(next.id);
    },
  };
}

export type PipelineKit = ReturnType<typeof usePipelineKit>;

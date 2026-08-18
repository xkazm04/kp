"use client";

// The board's compound filter state and its two-way URL sync (PIPE2 / PIPE3 /
// ANA1 / perfect-board). Owns the six filter dimensions, the debounced
// ?q/?quick/?score/?source/?sort/?stage write-back, and the visible-scope
// signature the bulk confirms are stamped with. Split out of usePipelineTabState.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import {
  parseQuicksParam,
  parseScoreBandsParam,
  parseSortParam,
  parseSourcesParam,
  serializeQuicks,
  serializeScoreBands,
  serializeSort,
  serializeSources,
  type QuickFilter,
  type ScoreBandKey,
  type SortKey,
} from "./pipelineBoardFilters";
import { visibleScopeSignature } from "./pipelineSelectionScope";
import type { StageDef } from "@/app/features/shared/pipelineTypes";

// ---- the ?stage= deep link, resolved against the board the workspace ACTUALLY has --
//
// UAT TOM-ANA-11 — the funnel that mints these links reads the workspace's own editable
// axis (`getPipelineAxis(workspaceId).stages`, resolved from Settings → Hiring), while
// the guard that accepted them read the HARDCODED five-stage `PIPELINE_STAGES`. A
// renamed or added column failed that guard and the filter was dropped on the floor: no
// pill, no error, the board rendering the unfiltered set — which reads as "nothing was
// filtered out". Silence is the trust defect there, not the mismatch: a drill-down that
// answers a different question than the one asked is worse than one that refuses.
//
// So the two halves are separated. The PARAM is carried verbatim (it is only ever an
// equality key against `entry.stage` — see entryMatchesFilters — so an arbitrary id is
// safe and a custom stage simply works), and whether the board can HONOUR it is a
// question only the resolved axis can answer. That axis arrives with the board payload
// (usePipelineBoardData → GET /api/pipeline), not at mount, so the answer is handed to
// the caller as an explicit state to RENDER rather than as a silent drop.

/** The `?stage=` value to filter on, or null when the param is absent/blank. */
export function readStageParam(raw: string | null): string | null {
  return (raw ?? "").trim() || null;
}

/** What the board can say about the active stage filter: how to NAME it, and whether
 *  it is still one of the board's columns. */
export type StageFilterResolution = {
  /** The workspace's OWN label for the stage, when it authored one. Null when the axis
   *  adds nothing to the id (the shipped axis stores `label === id`), which is the
   *  caller's signal to localize through the `enums.stage.*` catalog instead — the same
   *  idiom PipelineBoardOffAxisStrip uses, so a renamed column reads as the workspace
   *  named it while a default one stays translated. */
  label: string | null;
  onBoard: boolean;
};

/** Resolve the active stage against the workspace's rendered columns.
 *
 *  `retired` (the axis's tombstones, served beside the columns) supplies the label for a
 *  stage the workspace has since dropped, so a stale deep link can NAME the stage it
 *  points at instead of showing a bare id, and `onBoard: false` is what the filter bar
 *  turns into "this stage is no longer on your board". A stage on neither list resolves
 *  to no label at all: its id is the only identity anything still has for it. */
export function resolveStageFilter(
  stage: string,
  axis: readonly StageDef[],
  retired: readonly StageDef[] = []
): StageFilterResolution {
  const named = (s: StageDef | undefined): string | null => (s && s.label && s.label !== s.id ? s.label : null);
  const live = axis.find((s) => s.id === stage);
  if (live) return { label: named(live), onBoard: true };
  return { label: named(retired.find((s) => s.id === stage)), onBoard: false };
}

// The full compound-filter shape carried through the URL sync. Sort rides along so
// it's bookmarkable + saved-view-round-trippable, though it's a view preference,
// not a "filter" (so Clear leaves it be).
export type FilterUrlShape = {
  q: string;
  quicks: ReadonlySet<QuickFilter>;
  scoreBands: ReadonlySet<ScoreBandKey>;
  sources: ReadonlySet<string>;
  sort: SortKey;
  stage: string | null;
};

export function usePipelineFilters() {
  const nav = useShellNavigate();
  const search = useSearchParams();
  // Board search/filter (PIPE2): a free-text candidate/role query + one active
  // quick-filter chip. Client-side — the board already holds every entry.
  // ANA1: state hydrates from the URL ONCE at mount (lazy initializers off the
  // render-time searchParams) so analytics deep links (?q=/?quick=/?stage=)
  // land pre-filtered — the tab unmounts on every switch, so each navigation
  // re-reads them. In-board filter edits intentionally do NOT write back to the
  // URL (shareable view URLs are their own finding, PIPE3 in the 06-10 scan).
  const [query, setQuery] = useState(() => search.get("q") ?? "");
  // Compound filters (perfect-board): quick chips are now MULTI-select composing
  // with AND (?quick= is a CSV; a legacy single value hydrates as a one-element
  // set), plus score-band and source facets (OR within, AND across) and a within-
  // lane sort. All hydrate ONCE at mount from the URL, same as the query/stage.
  const [quicks, setQuicks] = useState<ReadonlySet<QuickFilter>>(() => parseQuicksParam(search.get("quick")));
  const [scoreBands, setScoreBands] = useState<ReadonlySet<ScoreBandKey>>(() => parseScoreBandsParam(search.get("score")));
  const [sources, setSources] = useState<ReadonlySet<string>>(() => parseSourcesParam(search.get("source")));
  const [sort, setSort] = useState<SortKey>(() => parseSortParam(search.get("sort")));
  // Stage filter (ANA1): the one dimension the funnel needs that the quick chips
  // don't cover. Deep-link-only entry (no always-visible chip mints it); shown
  // as a dismissible pill while active. UAT TOM-ANA-11 — carried verbatim; the axis
  // that decides whether it is honourable is resolved by the caller (resolveStageFilter
  // above), because it has not arrived yet at mount.
  const [stageFilter, setStageFilter] = useState<string | null>(() => readStageParam(search.get("stage")));

  // The identity of "what the board is showing" — every membership-affecting filter
  // input, order-independently (sort is excluded: reordering the same rows is not a
  // cohort change). Recomputed from the SAME state the filter predicate reads, so it
  // cannot drift from filteredEntries.
  const visibleScope = useMemo(
    () => visibleScopeSignature({ query, quicks, scoreBands, sources, stage: stageFilter }),
    [query, quicks, scoreBands, sources, stageFilter]
  );

  // PIPE3 — two-way URL sync: filter changes write back to the same ?q/?quick/
  // ?stage params the mount hydration (ANA1) reads, so the board's view state
  // is always a pasteable, bookmarkable URL. Replace, not push (no history spam);
  // typing debounces, chip clicks write immediately. Closes W9-1's deliberate
  // write-back deferral.
  //
  // The write goes through useShellNavigate, NOT router.replace: this is pure
  // CLIENT view state on a route whose server render ignores every one of these
  // params, so a router navigation only bought a ~358 KB RSC round-trip per chip
  // click and per debounced keystroke — the board's own filtering is a local array
  // pass that finishes in a fraction of it. See shell/nav/shallow-nav.ts.
  const urlSyncTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (urlSyncTimer.current != null) window.clearTimeout(urlSyncTimer.current);
  }, []);
  const writeFiltersToUrl = (next: FilterUrlShape, debounceMs = 0) => {
    const apply = () =>
      nav.replace(
        buildUrl(
          {
            q: next.q.trim() || null,
            quick: serializeQuicks(next.quicks),
            score: serializeScoreBands(next.scoreBands),
            source: serializeSources(next.sources),
            sort: serializeSort(next.sort),
            stage: next.stage,
          },
          search.toString()
        )
      );
    if (urlSyncTimer.current != null) window.clearTimeout(urlSyncTimer.current);
    if (debounceMs > 0) urlSyncTimer.current = window.setTimeout(apply, debounceMs);
    else apply();
  };
  // The current filter state as the URL shape, so a single-facet change only has to
  // override the one field it touches.
  const currentFilterShape = (): FilterUrlShape => ({ q: query, quicks, scoreBands, sources, sort, stage: stageFilter });
  // Replace EVERY facet at once and write the URL immediately — the shared primitive
  // behind the whole-board moves (Clear, the Today-rail stage focus, applying a saved
  // view, the degraded-cohort focus), each of which used to re-type the same six
  // setters. Setting a facet to its current value is a React no-op, so a caller that
  // only means to change some of them (Clear leaves `sort` alone) still reads right.
  const setAllFilters = (next: FilterUrlShape) => {
    setQuery(next.q);
    setQuicks(next.quicks);
    setScoreBands(next.scoreBands);
    setSources(next.sources);
    setSort(next.sort);
    setStageFilter(next.stage);
    writeFiltersToUrl(next);
  };
  const setQueryAndSync = (value: string) => {
    setQuery(value);
    writeFiltersToUrl({ ...currentFilterShape(), q: value }, 400);
  };
  // Toggle a member in/out of a facet set (multi-select), returning the new set.
  const toggled = <T,>(setValue: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(setValue);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };
  const toggleQuick = (f: QuickFilter) => {
    const next = toggled(quicks, f);
    setQuicks(next);
    writeFiltersToUrl({ ...currentFilterShape(), quicks: next });
  };
  const toggleBand = (b: ScoreBandKey) => {
    const next = toggled(scoreBands, b);
    setScoreBands(next);
    writeFiltersToUrl({ ...currentFilterShape(), scoreBands: next });
  };
  const toggleSource = (s: string) => {
    const next = toggled(sources, s);
    setSources(next);
    writeFiltersToUrl({ ...currentFilterShape(), sources: next });
  };
  const setSortAndSync = (s: SortKey) => {
    setSort(s);
    writeFiltersToUrl({ ...currentFilterShape(), sort: s });
  };
  const clearStageFilter = () => {
    setStageFilter(null);
    writeFiltersToUrl({ ...currentFilterShape(), stage: null });
  };
  // Today rail → board: focus on one stage, clearing the other filters so the
  // board shows exactly the cohort the rail row counted (sort is left as-is).
  const showStage = (stage: string) => setAllFilters({ q: "", ...emptyFacets(), sort, stage });
  const clearFilters = () => setAllFilters({ q: "", ...emptyFacets(), sort, stage: null });
  const filtering =
    Boolean(query.trim()) || quicks.size > 0 || scoreBands.size > 0 || sources.size > 0 || stageFilter !== null;

  return {
    query,
    quicks,
    scoreBands,
    sources,
    sort,
    stageFilter,
    visibleScope,
    filtering,
    setQueryAndSync,
    toggleQuick,
    toggleBand,
    toggleSource,
    setSortAndSync,
    clearStageFilter,
    showStage,
    clearFilters,
    setAllFilters,
  };
}

export type PipelineFilters = ReturnType<typeof usePipelineFilters>;

/** The three multi-select facets, emptied — the shape every whole-board reset shares. */
export function emptyFacets() {
  return {
    quicks: new Set<QuickFilter>(),
    scoreBands: new Set<ScoreBandKey>(),
    sources: new Set<string>(),
  };
}

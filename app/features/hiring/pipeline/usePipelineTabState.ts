"use client";

// All of PipelineTab's state, effects and handlers (board load/poll, compound
// filters + URL sync, saved views, bulk select/move/decide/invite/outreach, drag
// move, and the drawer/profile/job navigation helpers). Split out of the .tsx so
// the component file is just wiring + markup; this hook owns no JSX.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { boardSignature, eventsSignature } from "./pipelineRenderDiet";
import {
  SCORE_BANDS,
  entryMatchesFilters,
  entrySource,
  normalizeView,
  parseQuicksParam,
  parseScoreBandsParam,
  parseSortParam,
  parseSourcesParam,
  serializeQuicks,
  serializeScoreBands,
  serializeSort,
  serializeSources,
  setsEqual,
  sortFilteredEntries,
  UNATTRIBUTED_SOURCE,
  type QuickFilter,
  type SavedView,
  type ScoreBandKey,
  type SortKey,
} from "./pipelineBoardFilters";
import {
  normalizeStoredViews,
  defaultViewId,
  defaultViewToApply,
  withDefault,
  upsertViewByName,
  renameStoredView,
  nameCollides,
} from "./pipelineViews";
import { boardVisibleOrder, groupPositions } from "./pipelineBoardLayout";
import { armedConfirm, bulkConfirmReducer, type BulkConfirmIntent } from "./pipelineBulkConfirm";
import { selectionOutsideVisible, visibleScopeSignature } from "./pipelineSelectionScope";
import { recordRecent } from "@/app/features/shell/recents";
import { postPipelineAction, postPipelineBatch, type PipelineBatchItem } from "@/app/_lib/useAddToPipeline";
import { copyText } from "@/app/_lib/export-utils";
import { daysSince, entryLaneKey, slaForStage, STAGES, type Entry, type PipelineEvent } from "@/app/features/shared/pipelineTypes";
import { PIPELINE_SLA_KEY, PIPELINE_VIEWS_KEY, VIEW_PARAM_KEYS, newViewId, pipelineActionReason } from "./pipelineTabHelpers";

export function usePipelineTabState() {
  const router = useRouter();
  const search = useSearchParams();
  const t = useTranslations("pipeline.tab");
  // Source-facet chip labels reuse the channel-name catalog Analytics maintains
  // (mirrors the drawer's origin chip), falling back to the raw id for unmapped
  // values; the null-source sentinel gets its own localized "unattributed" label.
  const tChannels = useTranslations("analytics.channels");
  const channelName = (channel: string) => {
    if (channel === UNATTRIBUTED_SOURCE) return t("filterSourceUnattributed");
    const key = `names.${channel}` as Parameters<typeof tChannels>[0];
    return tChannels.has(key) ? tChannels(key) : channel;
  };
  // REC-10 — "invited to schedule" only reads as delivered when a relay exists;
  // without one the bulk invites are terminal outbox rows.
  const relayConfigured = useDeliveryCapability();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Activity-feed health is tracked separately from the board: a failed events
  // fetch must read as "couldn't load activity", never as a genuine empty feed.
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [drawerEntry, setDrawerEntry] = useState<Entry | null>(null);
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
  // as a dismissible pill while active.
  const [stageFilter, setStageFilter] = useState<string | null>(() => {
    const v = search.get("stage");
    return v && STAGES.includes(v) ? v : null;
  });
  // PIPE1 — bulk select mode: the filters isolate a cohort ("7 aging"), select
  // mode lets the recruiter act on it as a batch instead of N drawer trips.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkStage, setBulkStage] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // `verb` selects the result label so the same status line reads correctly for a
  // stage move vs. a bulk accept/reject (bdc7fc01).
  // `reason` carries the server's verbatim failure explanation (the 409 vs 422
  // guidance) for a bulk action whose entries were refused, so a batch failure is
  // no longer a bare count — the recruiter sees WHY, like the drag + drawer do.
  const [bulkResult, setBulkResult] = useState<{ ok: number; failed: number; verb: "moved" | "accepted" | "rejected" | "invited" | "drafted"; reason?: string | null } | null>(null);
  // Bulk outreach runs as a BACKGROUND task (N letters = N LLM calls), so unlike the
  // synchronous move/decide it can't resolve inline — we track the task id and apply
  // the failures-stay-selected grammar when it finishes. lastOutreachApplied guards
  // the completion effect to fire exactly once per task.
  const [outreachTaskId, setOutreachTaskId] = useState<string | null>(null);
  const lastOutreachApplied = useRef<string | null>(null);
  // Transient feedback when a drag-to-move fails (optimistic move rolled back).
  const [moveError, setMoveError] = useState<string | null>(null);
  // Two-step confirms for the two DESTRUCTIVE bulk actions, modelled as ONE
  // single-slot state (pipelineBulkConfirm.ts) so that "disarm on ANY selection
  // change" is one un-forgettable transition — the round-5 defect was two separate
  // booleans where only the reject flag got reset on a selection mutation, letting
  // an armed outreach confirm fire against a grown cohort. Reject emails N
  // candidates; outreach (WHEN a relay is configured) relays each drafted letter
  // immediately, so "draft N" IS "send N". Relay definitively off → drafts are
  // terminal Outbox rows and one click is safe; unknown capability (null) fails
  // safe like relay-on.
  //
  // bulk-acts-on-what-you-see — the confirm is additionally scoped to WHAT THE BOARD
  // WAS SHOWING when it was armed (visibleScope, below). Disarming on a selection
  // change alone left the mirror-image hole open: hold the selection still and change
  // the FILTER instead, and an armed reject survived into a board where its cohort is
  // invisible — one more click and they're emailed. The scope stamp closes it by
  // DERIVATION (armedConfirm) rather than by a disarm dispatch in each of the ~9
  // filter mutators, so a mutator added later is covered without anyone remembering.
  const [bulkConfirm, rawDispatchBulkConfirm] = useReducer(bulkConfirmReducer, null);
  // The identity of "what the board is showing" — every membership-affecting filter
  // input, order-independently (sort is excluded: reordering the same rows is not a
  // cohort change). Recomputed from the SAME state the filter predicate reads, so it
  // cannot drift from filteredEntries.
  const visibleScope = useMemo(
    () => visibleScopeSignature({ query, quicks, scoreBands, sources, stage: stageFilter }),
    [query, quicks, scoreBands, sources, stageFilter]
  );
  // Children dispatch a scope-free intent ({type:"arm", which}); the hook stamps the
  // scope in force at the moment of the click. Keeping the scope out of the child API
  // means a new bulk control physically cannot arm an unscoped confirm.
  const dispatchBulkConfirm = useCallback(
    (intent: BulkConfirmIntent) =>
      rawDispatchBulkConfirm(intent.type === "arm" ? { ...intent, scope: visibleScope } : intent),
    [visibleScope]
  );
  const armedBulkConfirm = armedConfirm(bulkConfirm, visibleScope);
  const confirmingBulkReject = armedBulkConfirm === "reject";
  const confirmingBulkOutreach = armedBulkConfirm === "outreach";
  // Saved board views (PIPE5): named {search + quick-filter} presets a recruiter
  // returns to, persisted in localStorage (single board, client-only — no schema).
  const [views, setViews] = useState<SavedView[]>([]);
  // views-earn-their-name — hydration + default application live together in one mount
  // effect defined AFTER applyView (below), so a marked default can open on a bare
  // visit while an explicit shared link still wins.
  const persistViews = (next: SavedView[]) => {
    setViews(next);
    try {
      localStorage.setItem(PIPELINE_VIEWS_KEY, JSON.stringify(next));
    } catch {
      /* storage full / unavailable — the in-memory list still works this session */
    }
  };
  // Per-stage aging SLA overrides (PIPE4): a recruiter's per-board tuning of the
  // STAGE_SLA_DEFAULTS, persisted in localStorage (client-only, no schema).
  const [slaOverrides, setSlaOverrides] = useState<Record<string, number>>({});
  const [editingSla, setEditingSla] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIPELINE_SLA_KEY);
      // Client-only localStorage — see the saved-views hydration above: a mount effect is the
      // SSR-safe way to read it, and a one-time set isn't a cascading-render concern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSlaOverrides(JSON.parse(raw) as Record<string, number>);
    } catch {
      /* corrupt/absent — fall back to defaults */
    }
  }, []);
  const setStageSla = (stage: string, days: number | null) => {
    const next = { ...slaOverrides };
    if (days && days > 0) next[stage] = days;
    else delete next[stage]; // cleared → back to the default
    setSlaOverrides(next);
    try {
      localStorage.setItem(PIPELINE_SLA_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — in-memory override still applies this session */
    }
  };
  const { tasks, startTask } = useTasks();
  // Watch the in-flight bulk-outreach draft run: cheap status/progress from the poll,
  // and its full per-candidate result once it finishes (see the completion effect).
  const outreachTask = useTaskResult(outreachTaskId);
  // 5d2e0998 — the empty board offers the guided tour (simulation start).
  const sim = useSimulation();
  const lastBatchDone = useRef<string | null>(null);

  // load() fires from many triggers (mount, live refresh, batch-done, the pass,
  // the scheduler, the drawer), so it self-sequences: each call aborts the prior
  // call's in-flight fetches, and a superseded response writes no state. That
  // kills two failure modes at once — a slow earlier response can't clobber a
  // newer board, and (because success always clears `error`) a single transient
  // fetch blip can't latch the error screen: the next good poll recovers the
  // view without a hard refresh.
  const abortRef = useRef<AbortController | null>(null);
  // Cursor into the events feed (idea-85f043ea): after the initial page, every
  // poll asks only for events strictly newer than the last id seen, so a burst
  // of automation activity can never scroll past a fixed-size window between
  // polls and vanish unseen. null = initial page not yet loaded.
  const eventsCursorRef = useRef<number | null>(null);
  // Poll-tick render diet: the content signature of the LAST board/events payload
  // we committed to state. A poll whose payload signature matches skips the state
  // set entirely — no new array identity, so bucketLaneEntries doesn't recompute
  // and no StageCell/CandidateRow reconciles. null = nothing committed yet (first
  // load always writes).
  const lastEntriesSigRef = useRef<string | null>(null);
  const lastEventsSigRef = useRef<string | null>(null);
  // The board signature folds each entry's DERIVED aging bucket, which depends on the
  // recruiter's per-board SLA overrides — read via a ref so the (stable, [t]-only)
  // load callback and its 30s poll see the current overrides without being recreated
  // on every override keystroke. Override EDITS reflect immediately via re-render
  // (isStale/staleCount recompute); the ref only keeps the poll gate consistent.
  const slaOverridesRef = useRef<Record<string, number>>({});
  useEffect(() => {
    slaOverridesRef.current = slaOverrides;
  }, [slaOverrides]);
  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    fetch("/api/pipeline", { signal })
      .then((r) => r.json())
      .then((p) => {
        if (signal.aborted) return; // a newer load superseded this one
        if (p.error) throw new Error(p.error);
        const next = (p.entries as Entry[]) ?? [];
        // Content-equality short-circuit: only reset the entries array when the
        // rendered content actually changed. setError(null) below is a no-op
        // re-render when error is already null (React bails on an identical value).
        const sig = boardSignature(next, { overrides: slaOverridesRef.current });
        if (sig !== lastEntriesSigRef.current) {
          lastEntriesSigRef.current = sig;
          setEntries(next);
        }
        setError(null); // success clears any prior transient error
      })
      .catch((e) => {
        if (signal.aborted) return; // ignore aborted/stale failures
        setError(e instanceof Error ? e.message : t("loadFailed"));
      });
    const since = eventsCursorRef.current;
    fetch(since == null ? "/api/pipeline/events" : `/api/pipeline/events?since=${since}`, { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((p) => {
        if (signal.aborted) return;
        if (p.error) throw new Error(p.error);
        const incoming = (p.events as PipelineEvent[]) ?? [];
        if (since == null) {
          // Initial page, newest-first. Same content-equality short-circuit as the
          // board: a re-fetched identical first page doesn't reset the list. (Poll
          // ticks use the delta branch below, which only sets on genuinely new
          // events, so the feed already no-ops on a quiet poll.)
          const sig = eventsSignature(incoming);
          if (sig !== lastEventsSigRef.current) {
            lastEventsSigRef.current = sig;
            setEvents(incoming);
          }
        } else if (incoming.length > 0) {
          // Delta mode returns oldest-first — newest belongs on top. Keep a
          // bounded in-memory tail; the list renders the top 12 anyway.
          const newestFirst = [...incoming].reverse();
          setEvents((prev) => [...newestFirst, ...prev].slice(0, 100));
        }
        if (typeof p.cursor === "number") eventsCursorRef.current = p.cursor;
        setEventsError(null);
      })
      .catch(() => {
        if (signal.aborted) return;
        setEventsError(t("eventsError"));
      });
  }, [t]);
  useEffect(() => {
    load();
    return () => abortRef.current?.abort(); // drop in-flight fetches on unmount
  }, [load]);
  useLiveRefresh(load); // re-fetch the board live when the simulation (or any actor) changes state

  // Live board poll. The automation clock (instrumentation.ts heartbeat) mutates
  // pipeline_entries SERVER-side with no client signal — useLiveRefresh only fires on
  // same-document changes — so an open board silently went stale under automation (and the
  // SchedulerControl bar could show "ran · 3 advanced" while the lanes didn't move). Poll
  // every 30s, reusing load()'s abort+cursor machinery (one /api/pipeline + one delta
  // /api/pipeline/events?since= per tick). Paused while a drawer is open (don't yank state
  // mid-action) or the tab is hidden. Drawer state is read via a ref so the interval stays
  // stable instead of restarting its countdown on every drawer toggle.
  const drawerOpenRef = useRef(false);
  useEffect(() => {
    drawerOpenRef.current = drawerEntry != null;
  }, [drawerEntry]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (drawerOpenRef.current || document.hidden) return;
      load();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const positions = useMemo(() => groupPositions(entries ?? []), [entries]);

  const approvals = (entries ?? []).filter((e) => needsHumanDecision(e.approvalKind) && e.status === "active");
  const activeCount = (entries ?? []).filter((e) => e.stage !== "Hired").length;
  const interviewCount = (entries ?? []).filter((e) => e.stage === "Interview").length;
  const isStale = (e: Entry) => e.stage !== "Hired" && (daysSince(e.stageChangedAt) ?? 0) >= slaForStage(e.stage, slaOverrides);
  const staleCount = (entries ?? []).filter(isStale).length;
  // Stubs from a failed intake normalization: visible, recoverable, and not yet
  // matchable until a recruiter captures the profile. Active-only — a rejected
  // stub is out of the funnel and doesn't need recovery.
  const degraded = (entries ?? []).filter((e) => e.intakeDegraded && e.status !== "rejected");
  const degradedCount = degraded.length;

  // Board search + compound filters (PIPE2 / perfect-board). The summary StatChips
  // above stay full totals; only the board (its lanes + cards) narrows. The composed
  // predicate lives in the pure filters module; the chosen sort is applied WITHIN the
  // filtered set (lanes group downstream, so this reorders cards within each cell).
  // boardPositions drops lanes with no surviving candidate so a filter doesn't leave
  // empty columns.
  const filteredEntries = useMemo(() => {
    const matched = (entries ?? []).filter((e) =>
      entryMatchesFilters(e, { query, quicks, scoreBands, sources, stage: stageFilter }, { overrides: slaOverrides })
    );
    return sortFilteredEntries(matched, sort);
  }, [entries, query, quicks, scoreBands, sources, stageFilter, slaOverrides, sort]);

  // bulk-acts-on-what-you-see — the selected rows the current filter HIDES. The
  // selection is deliberately NOT pruned when the filter changes (a recruiter who
  // filtered down to review a subset has not abandoned the rest, and silently
  // shrinking a cohort they built is its own surprise); the board pays for keeping it
  // by DISCLOSING the over-reach on the bulk bar, so no bulk action — move, invite,
  // outreach, accept/reject — can act on rows the recruiter cannot see without saying
  // so first. Resolved against `filteredEntries`, i.e. exactly what the board renders.
  const selectedOutsideIds = useMemo(
    () => selectionOutsideVisible(selectedIds, filteredEntries),
    [selectedIds, filteredEntries]
  );
  const selectedOutsideCount = selectedOutsideIds.length;

  // The distinct source/channel facet values present on the board (all entries, not
  // the filtered set), so the source chips only offer values that actually exist —
  // including the unattributed sentinel when any entry has no channel.
  const sourceValues = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries ?? []) s.add(entrySource(e));
    return [...s].sort();
  }, [entries]);

  // bdc7fc01 — the awaiting-decision subset of the current selection (the only
  // entries bulk accept/reject can act on), plus a per-approval-kind breakdown so
  // a mixed selection (screening vs offer vs scorecard) is obvious before acting.
  const selectedAwaiting = useMemo(
    () =>
      [...selectedIds]
        .map((id) => (entries ?? []).find((x) => x.id === id))
        .filter((e): e is Entry => !!e && needsHumanDecision(e.approvalKind) && e.status === "active"),
    [selectedIds, entries]
  );
  const awaitingKinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of selectedAwaiting) {
      const k = e.approvalKind ?? "decision";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()];
  }, [selectedAwaiting]);
  // P2-2 — the selected entries eligible for a bulk scheduling invite: any ACTIVE
  // candidate (never a terminal hired/rejected/declined one). The bulk-invite
  // endpoint re-checks status, so this is a UI gate, not the trust boundary.
  const selectedActive = useMemo(
    () =>
      [...selectedIds]
        .map((id) => (entries ?? []).find((x) => x.id === id))
        .filter((e): e is Entry => !!e && e.status === "active"),
    [selectedIds, entries]
  );
  const boardPositions = useMemo(() => groupPositions(filteredEntries), [filteredEntries]);
  // drawer-loop-hygiene — the drawer's prev/next cohort is the board's VISIBLE
  // sequence (lane by lane, stage column by column, within-cell order), not the
  // global filtered sort — so "next" walks the column the recruiter is reading
  // instead of jumping across stages. Derived from the same boardPositions +
  // filteredEntries the board renders, so it can never diverge from what's on screen.
  const cohortOrder = useMemo(() => boardVisibleOrder(boardPositions, filteredEntries), [boardPositions, filteredEntries]);
  const filtering =
    Boolean(query.trim()) || quicks.size > 0 || scoreBands.size > 0 || sources.size > 0 || stageFilter !== null;

  // PIPE3 — two-way URL sync: filter changes write back to the same ?q/?quick/
  // ?stage params the mount hydration (ANA1) reads, so the board's view state
  // is always a pasteable, bookmarkable URL. router.replace (no history spam);
  // typing debounces, chip clicks write immediately. Closes W9-1's deliberate
  // write-back deferral.
  const urlSyncTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (urlSyncTimer.current != null) window.clearTimeout(urlSyncTimer.current);
  }, []);
  // The full compound-filter shape carried through the URL sync. Sort rides along so
  // it's bookmarkable + saved-view-round-trippable, though it's a view preference,
  // not a "filter" (so Clear leaves it be).
  type FilterUrlShape = {
    q: string;
    quicks: ReadonlySet<QuickFilter>;
    scoreBands: ReadonlySet<ScoreBandKey>;
    sources: ReadonlySet<string>;
    sort: SortKey;
    stage: string | null;
  };
  const writeFiltersToUrl = (next: FilterUrlShape, debounceMs = 0) => {
    const apply = () =>
      router.replace(
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
        ),
        { scroll: false }
      );
    if (urlSyncTimer.current != null) window.clearTimeout(urlSyncTimer.current);
    if (debounceMs > 0) urlSyncTimer.current = window.setTimeout(apply, debounceMs);
    else apply();
  };
  // The current filter state as the URL shape, so a single-facet change only has to
  // override the one field it touches.
  const currentFilterShape = (): FilterUrlShape => ({ q: query, quicks, scoreBands, sources, sort, stage: stageFilter });
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
  const showStage = (stage: string) => {
    const empty = { quicks: new Set<QuickFilter>(), scoreBands: new Set<ScoreBandKey>(), sources: new Set<string>() };
    setQuery("");
    setQuicks(empty.quicks);
    setScoreBands(empty.scoreBands);
    setSources(empty.sources);
    setStageFilter(stage);
    writeFiltersToUrl({ q: "", ...empty, sort, stage });
  };
  const clearFilters = () => {
    const empty = { quicks: new Set<QuickFilter>(), scoreBands: new Set<ScoreBandKey>(), sources: new Set<string>() };
    setQuery("");
    setQuicks(empty.quicks);
    setScoreBands(empty.scoreBands);
    setSources(empty.sources);
    setStageFilter(null);
    writeFiltersToUrl({ q: "", ...empty, sort, stage: null });
  };
  // drawer-flow-friction — the degraded/needs-intake chip ARMS the board's existing
  // `intake` quick filter (reused, not forked) so the whole stub cohort is isolated,
  // then opens the first one; the drawer's prev/next then walks the now-filtered
  // cohort (cohortOrder) stub-by-stub instead of the old open-degraded[0]-only
  // dead end. Clears the other facets so the board shows exactly the needs-intake set.
  const focusDegradedCohort = () => {
    const quicksSet = new Set<QuickFilter>(["intake"]);
    const empty = { scoreBands: new Set<ScoreBandKey>(), sources: new Set<string>() };
    setQuery("");
    setQuicks(quicksSet);
    setScoreBands(empty.scoreBands);
    setSources(empty.sources);
    setStageFilter(null);
    writeFiltersToUrl({ q: "", quicks: quicksSet, ...empty, sort, stage: null });
    // drawer-loop-hygiene — single-source the opened entry: derive it from the SAME
    // predicate + array the board is about to show (the intake-filtered set, in the
    // board's visible order) rather than the separate unfiltered `degraded` list. So
    // "open" and prev/next walk one cohort — the opened stub is genuinely cohort[0].
    const cohort = (entries ?? []).filter((e) =>
      entryMatchesFilters(
        e,
        { query: "", quicks: quicksSet, scoreBands: empty.scoreBands, sources: empty.sources, stage: null },
        { overrides: slaOverrides }
      )
    );
    const sorted = sortFilteredEntries(cohort, sort);
    const ordered = boardVisibleOrder(groupPositions(sorted), sorted);
    if (ordered.length > 0) setDrawerEntry(ordered[0]);
  };
  // PIPE3 — a saved view as a pasteable link: built from a CLEAN query string
  // (not the current one) so the share never drags along unrelated params.
  const [copiedViewId, setCopiedViewId] = useState<string | null>(null);
  const copyViewLink = async (v: SavedView) => {
    // Encode the WHOLE view (compound quicks + score/source facets + sort + stage) so
    // a shared link reopens exactly the board the sharer saved — a view saved with an
    // active funnel stage or a score band used to share a link that silently dropped
    // it. Normalize first so a legacy single-quick view still shares correctly.
    const nv = normalizeView(v);
    const href = `${window.location.origin}${buildUrl(
      {
        tab: "pipeline",
        q: nv.query.trim() || null,
        quick: serializeQuicks(new Set(nv.quicks)),
        score: serializeScoreBands(new Set(nv.scoreBands)),
        source: serializeSources(new Set(nv.sources)),
        sort: serializeSort(nv.sort),
        stage: nv.stage,
      },
      ""
    )}`;
    if (await copyText(href)) {
      setCopiedViewId(v.id);
      window.setTimeout(() => setCopiedViewId((cur) => (cur === v.id ? null : cur)), 2000);
    }
  };
  // PIPE5 — save the current filter combo as a named view, apply one, or drop it.
  // The active-view match compares the WHOLE normalized shape (compound quicks +
  // score/source facets + sort + stage, order-independently) so a view isn't falsely
  // marked active just because part of it agrees, and a legacy single-quick view
  // still matches once normalized.
  const activeViewId =
    views.find((v) => {
      const nv = normalizeView(v);
      return (
        nv.query === query &&
        setsEqual(quicks, nv.quicks) &&
        setsEqual(scoreBands, nv.scoreBands) &&
        setsEqual(sources, nv.sources) &&
        nv.sort === sort &&
        nv.stage === stageFilter
      );
    })?.id ?? null;
  // views-earn-their-name — save/rename run through the app's Modal idiom (no more
  // window.prompt, the board's last blocking native dialog). One dialog state serves
  // both: `save` names+captures the current combo (with an optional "open by default"
  // toggle); `rename` relabels an existing view, keeping its identity.
  const [viewDialog, setViewDialog] = useState<
    | { mode: "save"; name: string; asDefault: boolean }
    | { mode: "rename"; id: string; name: string }
    | null
  >(null);
  const openSaveView = () =>
    setViewDialog({ mode: "save", name: query.trim() || (quicks.size ? [...quicks][0] : ""), asDefault: false });
  const openRenameView = (v: SavedView) => setViewDialog({ mode: "rename", id: v.id, name: v.name });
  const commitViewDialog = () => {
    if (!viewDialog) return;
    const name = viewDialog.name.trim();
    if (!name) return;
    if (viewDialog.mode === "rename") {
      persistViews(renameStoredView(views, viewDialog.id, name));
    } else {
      // Capture the WHOLE active combo — every facet the recruiter is looking at, so
      // the view reopens the same board. `quick` (single) is written too for forward
      // back-compat with any older reader. A fresh opaque id decouples the view from
      // its name (a later rename keeps identity). Saving under an existing name
      // overwrites (upsertByName) — the modal makes that explicit.
      const view: SavedView = {
        id: newViewId(),
        name,
        query,
        quicks: [...quicks],
        quick: quicks.size ? [...quicks][0] : null,
        score: [...scoreBands],
        source: [...sources],
        sort,
        stage: stageFilter,
        isDefault: viewDialog.asDefault ? true : undefined,
      };
      let next = upsertViewByName(views, view);
      if (viewDialog.asDefault) next = withDefault(next, view.id);
      persistViews(next);
    }
    setViewDialog(null);
  };
  // Toggle the DEFAULT marking on a view — the one that opens on a bare visit. Clicking
  // the current default clears it (so a board can have no default again).
  const toggleDefaultView = (v: SavedView) =>
    persistViews(withDefault(views, defaultViewId(views) === v.id ? null : v.id));
  const applyView = (v: SavedView) => {
    const nv = normalizeView(v);
    const quicksSet = new Set(nv.quicks);
    const bandsSet = new Set(nv.scoreBands);
    const sourcesSet = new Set(nv.sources);
    setQuery(nv.query);
    setQuicks(quicksSet);
    setScoreBands(bandsSet);
    setSources(sourcesSet);
    setSort(nv.sort);
    setStageFilter(nv.stage);
    writeFiltersToUrl({ q: nv.query, quicks: quicksSet, scoreBands: bandsSet, sources: sourcesSet, sort: nv.sort, stage: nv.stage });
  };
  const deleteView = (id: string) => persistViews(views.filter((v) => v.id !== id));

  // Mount hydration + default application (views-earn-their-name). localStorage is
  // client-only, so this reads it in a mount effect (the SSR-safe path — a lazy
  // initializer would mismatch the server's empty HTML). normalizeStoredViews migrates
  // the legacy bare-array shape and enforces one default. PRECEDENCE: an explicit
  // shared/deep link (any VIEW_PARAM_KEYS present) WINS — only a bare visit applies the
  // marked default, so a pasted link opens exactly what it encodes, never overridden.
  // A one-time mount set isn't the cascading-render case the set-state rule targets.
  useEffect(() => {
    let loaded: SavedView[] = [];
    try {
      const raw = localStorage.getItem(PIPELINE_VIEWS_KEY);
      loaded = raw ? normalizeStoredViews(JSON.parse(raw)) : [];
    } catch {
      loaded = []; // corrupt/absent — start empty
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViews(loaded);
    const hasExplicit = VIEW_PARAM_KEYS.some((k) => search.get(k) != null);
    const def = defaultViewToApply(loaded, hasExplicit);
    if (def) applyView(def);
    // Mount-only: hydrate + apply once. applyView/search are intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PIPE1 — bulk move. ONE batch POST, each item carrying its OWN expectedStage
  // (the stage the board showed for THAT card) — a per-id 409 means a concurrent
  // actor moved that candidate, and the MatrixTab W11 grammar applies: the failure
  // STAYS SELECTED for retry while successes deselect.
  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
    setBulkResult(null);
    dispatchBulkConfirm({ type: "selectionChanged" });
  };
  const toggleSelected = (e: Entry) => {
    setBulkResult(null);
    dispatchBulkConfirm({ type: "selectionChanged" });
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(e.id)) next.delete(e.id);
      else next.add(e.id);
      return next;
    });
  };
  const selectAllVisible = () => {
    setBulkResult(null);
    dispatchBulkConfirm({ type: "selectionChanged" });
    setSelectedIds(new Set(filteredEntries.map((e) => e.id)));
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    dispatchBulkConfirm({ type: "selectionChanged" });
  };
  // A WHOLE-REQUEST batch refusal (the operator gate's 401/403, or a transport
  // blip with no per-id results) is NOT a per-id reason — surface an honest,
  // localized line so a bulk action that was blocked reads as blocked, not as a
  // silent count or a fabricated per-id error. Mirrors the command bar, which is
  // operator-gated in lock-step (batch-authz-parity).
  const batchRequestReason = (res: { ok: false; status?: number }): string =>
    res.status === 401 || res.status === 403 ? t("bulkNotPermitted") : t("bulkRequestFailed");
  const bulkMove = async () => {
    if (!bulkStage || selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkResult(null);
    let moved = 0;
    const failures = new Set<string>();
    // A whole-request refusal reason (operator gate / transport), distinct from the
    // per-id server reasons — it overrides the per-id line when the whole call fell.
    let requestReason: string | null = null;
    // Distinct server reasons across the refused entries (a batch can mix a 409
    // concurrency loss with a 422 forbidden transition) — deduped so the status
    // line names WHY, not just how many.
    const reasons = new Set<string>();
    // Build the batch: skip vanished entries; count an already-at-target card as
    // moved without a round trip (the server would no-op it anyway).
    const items: PipelineBatchItem[] = [];
    for (const id of selectedIds) {
      const entry = (entries ?? []).find((x) => x.id === id);
      if (!entry) continue; // vanished since selection — nothing left to move
      if (entry.stage === bulkStage) {
        moved += 1; // already at the target — done, deselect
        continue;
      }
      items.push({ id, action: "set_stage", toStage: bulkStage, expectedStage: entry.stage });
    }
    if (items.length > 0) {
      const res = await postPipelineBatch(items);
      if (res.ok) {
        for (const r of res.results) {
          if (r.ok) moved += 1;
          else {
            failures.add(r.id);
            if (r.reason) reasons.add(r.reason);
          }
        }
      } else {
        // Whole-request failure (operator gate refusal or transport blip) — every
        // attempted item stays selected for retry, with an honest refusal reason.
        for (const it of items) failures.add(it.id);
        requestReason = batchRequestReason(res);
      }
    }
    setSelectedIds(failures);
    setBulkResult({
      ok: moved,
      failed: failures.size,
      verb: "moved",
      reason: requestReason ?? (reasons.size ? [...reasons].join(" · ") : null),
    });
    setBulkBusy(false);
    await load();
  };

  // bdc7fc01 — bulk accept/reject the AWAITING cohort in the selection. Acts only
  // on selected entries that need a human decision (others have nothing to decide
  // and are left selected, untouched). ONE batch POST, each item carrying its OWN
  // expectedStage so a concurrent move is a per-id 409 that STAYS SELECTED for retry
  // — same grammar as bulkMove. A bulk reject emails everyone, so it's confirm-gated.
  const bulkDecide = async (action: "accept" | "reject") => {
    const awaiting = [...selectedIds]
      .map((id) => (entries ?? []).find((x) => x.id === id))
      .filter((e): e is Entry => !!e && needsHumanDecision(e.approvalKind) && e.status === "active");
    if (awaiting.length === 0 || bulkBusy) return;
    // bulk-acts-on-what-you-see — belt AND braces: reject emails everyone, so it fires
    // only while the confirm is armed UNDER THE CURRENT VISIBLE SCOPE. The bar already
    // reverts to the un-armed button when the scope changes, but the guard lives at the
    // fire site too, so a future caller (a shortcut, the command bar) can't route around
    // the render-level gate.
    if (action === "reject" && armedConfirm(bulkConfirm, visibleScope) !== "reject") {
      dispatchBulkConfirm({ type: "arm", which: "reject" });
      return;
    }
    setBulkBusy(true);
    setBulkResult(null);
    dispatchBulkConfirm({ type: "fired" });
    let ok = 0;
    const failed = new Set<string>();
    // Same as bulkMove: surface the server's distinct reasons for refused decides
    // (e.g. a 409 stage change that lost the CAS in the gap) rather than a count.
    const reasons = new Set<string>();
    let requestReason: string | null = null;
    const items: PipelineBatchItem[] = awaiting.map((e) => ({ id: e.id, action, expectedStage: e.stage }));
    const res = await postPipelineBatch(items);
    if (res.ok) {
      for (const r of res.results) {
        if (r.ok) ok += 1;
        else {
          failed.add(r.id);
          if (r.reason) reasons.add(r.reason);
        }
      }
    } else {
      // Whole-request failure (operator gate refusal or transport blip) — every
      // attempted decision stays selected for retry, with an honest refusal reason.
      for (const e of awaiting) failed.add(e.id);
      requestReason = batchRequestReason(res);
    }
    // Successes deselect; failures + any selected non-awaiting entries stay selected.
    const untouched = [...selectedIds].filter((id) => !awaiting.some((e) => e.id === id));
    setSelectedIds(new Set([...failed, ...untouched]));
    setBulkResult({
      ok,
      failed: failed.size,
      verb: action === "accept" ? "accepted" : "rejected",
      reason: requestReason ?? (reasons.size ? [...reasons].join(" · ") : null),
    });
    setBulkBusy(false);
    await load();
  };

  // P2-2 — send self-scheduling links to the selected ACTIVE cohort in one action
  // (the back half of the funnel was per-candidate-only). ONE round trip to the
  // bulk endpoint, which isolates each entry; successes deselect, failures + any
  // terminal selected entries stay selected for retry — same grammar as bulkDecide.
  const bulkInvite = async () => {
    if (selectedActive.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkResult(null);
    dispatchBulkConfirm({ type: "fired" });
    let ok = 0;
    const failed = new Set<string>();
    try {
      const r = await fetch("/api/schedule/invite/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: selectedActive.map((e) => e.id) }),
      });
      const d = (await r.json().catch(() => null)) as { results?: { entryId: string; ok: boolean }[] } | null;
      if (r.ok && d?.results) {
        for (const res of d.results) (res.ok ? (ok += 1) : failed.add(res.entryId));
      } else {
        for (const e of selectedActive) failed.add(e.id);
      }
    } catch {
      for (const e of selectedActive) failed.add(e.id);
    }
    const untouched = [...selectedIds].filter((id) => !selectedActive.some((e) => e.id === id));
    setSelectedIds(new Set([...failed, ...untouched]));
    setBulkResult({ ok, failed: failed.size, verb: "invited" });
    setBulkBusy(false);
    await load();
  };

  // Draft tailored OUTREACH for the selected ACTIVE cohort in one action — the same
  // per-candidate "Draft outreach" the drawer runs, but for N candidates at once so a
  // filtered cohort of 8 isn't 8 drawer trips. Backgrounded (N letters = N LLM calls),
  // so this only STARTS the task; the drafts land in the Outbox as reviewable rows
  // (nothing auto-sends in the demo default) and the completion effect below applies
  // the failures-stay-selected grammar once the run finishes. Reuses the same task
  // machinery the board already tracks for batch-screen.
  const bulkOutreach = async () => {
    if (selectedActive.length === 0 || outreachTask.active) return;
    // With a relay configured (or unknown), a draft IS a send — same fire-site scope
    // guard as the reject above. Relay definitively off → drafts are terminal Outbox
    // rows and the one-click path stays.
    if (relayConfigured !== false && armedConfirm(bulkConfirm, visibleScope) !== "outreach") {
      dispatchBulkConfirm({ type: "arm", which: "outreach" });
      return;
    }
    setBulkResult(null);
    dispatchBulkConfirm({ type: "fired" });
    const started = await startTask("batch_outreach", { entryIds: selectedActive.map((e) => e.id) });
    if (started) {
      lastOutreachApplied.current = null; // a fresh run — allow its completion to apply once
      setOutreachTaskId(started.id);
    }
  };

  // Apply the batch grammar when the background draft run finishes: successes
  // deselect, per-candidate failures STAY selected for retry (plus any selected
  // entry the run never attempted — e.g. a terminal one), and the honest
  // queued-vs-sent count lands in the shared status line. A task-level failure
  // (the whole run threw) keeps the whole cohort selected and surfaces the reason.
  useEffect(() => {
    if (!outreachTaskId) return;
    if (outreachTask.status === "failed" || outreachTask.status === "interrupted" || outreachTask.status === "canceled") {
      if (lastOutreachApplied.current === outreachTaskId) return;
      lastOutreachApplied.current = outreachTaskId;
      setBulkResult({ ok: 0, failed: selectedIds.size, verb: "drafted", reason: outreachTask.error });
      setOutreachTaskId(null);
      return;
    }
    const full = outreachTask.full;
    if (!full || full.id !== outreachTaskId) return;
    if (lastOutreachApplied.current === outreachTaskId) return;
    lastOutreachApplied.current = outreachTaskId;
    const res = (full.result as { ok?: number; total?: number; results?: { id: string; ok: boolean }[] } | null) ?? null;
    const items = res?.results ?? [];
    const attempted = new Set(items.map((r) => r.id));
    const failed = new Set(items.filter((r) => !r.ok).map((r) => r.id));
    // Keep a selected id iff it failed, or the run never touched it (untouched stays).
    setSelectedIds((cur) => new Set([...cur].filter((id) => failed.has(id) || !attempted.has(id))));
    setBulkResult({ ok: res?.ok ?? 0, failed: failed.size, verb: "drafted", reason: null });
    setOutreachTaskId(null);
    void load();
  }, [outreachTaskId, outreachTask.status, outreachTask.full, outreachTask.error, selectedIds, load]);

  // cea12908 — drag a candidate to a new stage column. Optimistic: reflect the
  // move immediately, then POST set_stage with the card's PRIOR stage as
  // expectedStage (the same CAS guard the bulk move + AI actions use). On any
  // failure roll back; load() always reconciles the board with the server (a 409
  // means a concurrent actor moved them in the gap).
  const moveEntry = async (entry: Entry, toStage: string) => {
    if (entry.stage === toStage) return;
    const prevStage = entry.stage;
    const restage = (id: string, stage: string) =>
      setEntries((cur) => (cur ? cur.map((e) => (e.id === id ? { ...e, stage } : e)) : cur));
    restage(entry.id, toStage);
    setMoveError(null);
    try {
      const r = await postPipelineAction(entry.id, { action: "set_stage", toStage, expectedStage: prevStage });
      // On any failure roll back AND tell the recruiter the SERVER's reason — the
      // 409 "changed since you opened it" (a concurrent actor moved them) vs the
      // 422 "route through Offer → extend an offer" guidance, distinguished and
      // verbatim, exactly like the drawer's moveStage. The blanket moveFailed hid
      // the one sentence telling the recruiter what to do instead. A body with no
      // reason (a network-level failure) falls back to the generic copy.
      if (!r.ok) {
        restage(entry.id, prevStage);
        setMoveError((await pipelineActionReason(r)) ?? t("moveFailed"));
      }
    } catch {
      restage(entry.id, prevStage);
      setMoveError(t("moveFailed"));
    } finally {
      await load();
    }
  };

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
  const openEntryById = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/pipeline/${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const d = (await r.json()) as { entry?: Entry };
      if (d?.entry) setDrawerEntry(d.entry);
    } catch {
      /* network blip — leave the drawer as-is */
    }
  }, []);
  // Candidate name → the analyzed profile (Match view); falls back to the
  // AI-actions drawer when the entry has no linked candidate id.
  const openProfile = (e: Entry) => {
    if (!e.candidateId) {
      setDrawerEntry(e);
      return;
    }
    const href = buildUrl({ tab: "match", profile: e.candidateId }, search.toString());
    recordRecent({ type: "profile", id: e.candidateId, label: e.candidateLabel, href });
    router.push(href);
  };
  const openJob = (jobId: string) => {
    const href = buildUrl({ tab: "jobs", job: jobId }, search.toString());
    const title = (entries ?? []).find((e) => e.jobId === jobId)?.jobTitle;
    recordRecent({ type: "job", id: jobId, label: title ?? jobId, href });
    router.push(href);
  };
  // The "awaiting you" stat chip and the approvals banner both jump to Decisions.
  const goToDecisions = () => router.push(buildUrl({ tab: "decisions" }, search.toString()));

  // Reload the board when a background batch-screen finishes (it mutates many entries).
  useEffect(() => {
    const done = tasks.find((t) => t.kind === "batch_screen" && t.status === "succeeded");
    if (done?.finishedAt && done.finishedAt !== lastBatchDone.current) {
      lastBatchDone.current = done.finishedAt;
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);
  // "Rank candidates" → the Fit matrix scoped to this position (a per-position ranking).
  const openPositionRanking = (jobId: string) => router.push(buildUrl({ tab: "matrix", job: jobId }, search.toString()));

  return {
    t, channelName, relayConfigured,
    entries, events, error, eventsError, load,
    drawerEntry, setDrawerEntry,
    query, setQueryAndSync,
    quicks, toggleQuick,
    scoreBands, toggleBand,
    sources, toggleSource, sourceValues,
    sort, setSortAndSync,
    stageFilter, clearStageFilter, showStage, clearFilters,
    selectMode, toggleSelectMode,
    selectedIds, toggleSelected, selectAllVisible, clearSelection, selectedOutsideCount,
    bulkStage, setBulkStage, bulkBusy, bulkResult,
    confirmingBulkReject, confirmingBulkOutreach, dispatchBulkConfirm,
    views, viewDialog, setViewDialog, openSaveView, openRenameView, commitViewDialog,
    toggleDefaultView, applyView, deleteView, activeViewId, copyViewLink, copiedViewId,
    slaOverrides, setStageSla, editingSla, setEditingSla,
    positions, activeCount, interviewCount, staleCount, degradedCount, approvals,
    filteredEntries, boardPositions, cohortOrder, filtering,
    isStale, moveError, setMoveError, moveEntry,
    openActions, openEntryById, openProfile, openJob, openPositionRanking, goToDecisions,
    selectedAwaiting, awaitingKinds, selectedActive,
    bulkMove, bulkDecide, bulkInvite, bulkOutreach,
    outreachTaskActive: outreachTask.active,
    sim,
    focusDegradedCohort,
    SCORE_BANDS,
  };
}

export type PipelineTabState = ReturnType<typeof usePipelineTabState>;

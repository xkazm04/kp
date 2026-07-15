"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BookmarkPlus, CalendarClock, CheckSquare, Link2, Mail, Play, Timer, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { useSimulation } from "@/app/features/simulation/SimulationProvider";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { useDeliveryCapability } from "@/app/features/useDeliveryCapability";
import { useLiveRefresh } from "@/app/features/live-refresh";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { CHIP_TOGGLE, EYEBROW, INTRO, PAGE_HEADER, SECTION, STAT, STAT_LABEL, STAT_VALUE, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { CandidateDrawer } from "./CandidateDrawer";
import { PipelineBoard } from "./PipelineBoard";
import { boardSignature, eventsSignature } from "./pipeline-render-diet";
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
} from "./pipeline-board-filters";
import { bulkConfirmReducer } from "./pipeline-bulk-confirm";
import { EventDot, useEventVerb, useRelativeTime } from "./PipelineShared";
import { TodayRail } from "./TodayRail";
import { recordRecent } from "@/app/features/recents";
import { postPipelineAction, postPipelineBatch, type PipelineBatchItem } from "@/app/_lib/useAddToPipeline";
import { copyText } from "@/app/_lib/export-utils";
import { daysSince, entryLaneKey, slaForStage, STAGE_SLA_DEFAULTS, STAGES, type Entry, type PipelineEvent, type Position } from "./PipelineTypes";

// Compact header stat: label over value, optionally clickable. Replaces the old
// full-width Kpi card grid — the same numbers now live as a tight cluster in the
// page's top-right corner so the board gets the vertical space.
function StatChip({
  label,
  value,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "coral" | "amber" | "red";
  onClick?: () => void;
}) {
  const valueColor =
    tone === "coral" ? "text-coral" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-ink";
  const cls = `${STAT} min-w-[5rem] items-center px-3 py-2`;
  const inner = (
    <>
      <span className={`${STAT_LABEL} text-center`}>{label}</span>
      <span className={`${STAT_VALUE} ${valueColor}`}>{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} focus-ring transition-colors hover:border-coral/50`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

// Group entries into position lanes (job id ?? title ?? "?"), sorted by title.
// Pulled out of the component so it can run over BOTH the full board (the
// position count) and the filtered board (the lanes actually rendered) without
// duplicating the keying — which must match PipelineBoard's own lane key.
function groupPositions(entries: Entry[]): Position[] {
  const map = new Map<string, Position>();
  for (const e of entries) {
    const key = entryLaneKey(e);
    if (!map.has(key)) map.set(key, { id: key, title: e.jobTitle ?? "—", family: e.roleFamily ?? "", count: 0 });
    map.get(key)!.count += 1;
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// The quick-filter list, the score-band / source facets, the sort options, the
// composed predicate, and the URL/saved-view (de)serialization all live in the pure,
// unit-pinned pipeline-board-filters module (imported above) so the board's filters
// can never diverge from what a card renders. This file wires them to state + URL.
const PIPELINE_VIEWS_KEY = "kp.pipelineViews";
const PIPELINE_SLA_KEY = "kp.pipelineStageSla"; // per-stage aging overrides (PIPE4)

// Read the server's OWN explanation from a failed pipeline action response — the
// 409 "changed since you opened it" (a concurrent actor moved them) vs the 422
// "route through Offer → extend an offer" (a forbidden transition) guidance the
// recruiter actually needs, distinguished because the route returns a different
// message per status. Surfaced verbatim, the same way the drawer's moveStage
// does (CandidateDrawer.tsx). Returns null when the body carries no reason (a
// network throw / opaque error), so the caller falls back to its localized copy.
async function pipelineActionReason(r: Response): Promise<string | null> {
  try {
    const d = (await r.json()) as { error?: unknown };
    return typeof d?.error === "string" && d.error.trim() ? d.error : null;
  } catch {
    return null;
  }
}

export function PipelineTab() {
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
  const enumLabel = useEnumLabel();
  const eventVerb = useEventVerb();
  const relativeTime = useRelativeTime();
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
  // single-slot state (pipeline-bulk-confirm.ts) so that "disarm on ANY selection
  // change" is one un-forgettable transition — the round-5 defect was two separate
  // booleans where only the reject flag got reset on a selection mutation, letting
  // an armed outreach confirm fire against a grown cohort. Reject emails N
  // candidates; outreach (WHEN a relay is configured) relays each drafted letter
  // immediately, so "draft N" IS "send N". Relay definitively off → drafts are
  // terminal Outbox rows and one click is safe; unknown capability (null) fails
  // safe like relay-on.
  const [bulkConfirm, dispatchBulkConfirm] = useReducer(bulkConfirmReducer, null);
  const confirmingBulkReject = bulkConfirm === "reject";
  const confirmingBulkOutreach = bulkConfirm === "outreach";
  // Saved board views (PIPE5): named {search + quick-filter} presets a recruiter
  // returns to, persisted in localStorage (single board, client-only — no schema).
  const [views, setViews] = useState<SavedView[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIPELINE_VIEWS_KEY);
      // localStorage is client-only, so hydrating it in a mount effect is the SSR-safe path:
      // reading it during render / in a lazy initializer would mismatch the server's empty
      // HTML. This one-time mount set isn't the cascading-render case the rule targets.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setViews(JSON.parse(raw) as SavedView[]);
    } catch {
      /* corrupt/absent — start empty */
    }
  }, []);
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
  // cohort (filteredEntries) stub-by-stub instead of the old open-degraded[0]-only
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
    if (degraded.length > 0) setDrawerEntry(degraded[0]);
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
  const saveView = () => {
    const suggested = query.trim() || (quicks.size ? [...quicks][0] : "view");
    const name = window.prompt(t("saveViewPrompt"), suggested)?.trim();
    if (!name) return;
    // Capture the WHOLE active combo — every facet the recruiter is looking at, so
    // the view reopens the same board. `quick` (single) is written too for forward
    // back-compat with any older reader.
    const view: SavedView = {
      id: name,
      name,
      query,
      quicks: [...quicks],
      quick: quicks.size ? [...quicks][0] : null,
      score: [...scoreBands],
      source: [...sources],
      sort,
      stage: stageFilter,
    };
    persistViews([...views.filter((v) => v.name !== name), view]);
  };
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
  const bulkMove = async () => {
    if (!bulkStage || selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkResult(null);
    let moved = 0;
    const failures = new Set<string>();
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
        // Transport-level failure — every attempted item stays selected for retry.
        for (const it of items) failures.add(it.id);
      }
    }
    setSelectedIds(failures);
    setBulkResult({ ok: moved, failed: failures.size, verb: "moved", reason: reasons.size ? [...reasons].join(" · ") : null });
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
    setBulkBusy(true);
    setBulkResult(null);
    dispatchBulkConfirm({ type: "fired" });
    let ok = 0;
    const failed = new Set<string>();
    // Same as bulkMove: surface the server's distinct reasons for refused decides
    // (e.g. a 409 stage change that lost the CAS in the gap) rather than a count.
    const reasons = new Set<string>();
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
      // Transport-level failure — every attempted decision stays selected for retry.
      for (const e of awaiting) failed.add(e.id);
    }
    // Successes deselect; failures + any selected non-awaiting entries stay selected.
    const untouched = [...selectedIds].filter((id) => !awaiting.some((e) => e.id === id));
    setSelectedIds(new Set([...failed, ...untouched]));
    setBulkResult({
      ok,
      failed: failed.size,
      verb: action === "accept" ? "accepted" : "rejected",
      reason: reasons.size ? [...reasons].join(" · ") : null,
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

  return (
    <div className={`stagger-children ${SECTION}`} aria-busy={entries == null}>
      <header className={PAGE_HEADER}>
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h2>
          <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
        </div>
        {entries && entries.length > 0 ? (
          <div className="flex flex-wrap items-stretch gap-1.5">
            <StatChip label={t("statPositions")} value={positions.length} />
            <StatChip label={t("statActive")} value={activeCount} />
            <StatChip label={t("statInterview")} value={interviewCount} />
            <StatChip
              label={t("statAging")}
              value={staleCount}
              tone={staleCount > 0 ? "amber" : "neutral"}
              onClick={staleCount > 0 ? () => toggleQuick("aging") : undefined}
            />
            {degradedCount > 0 ? (
              <StatChip
                label={t("statNeedsIntake")}
                value={degradedCount}
                tone="red"
                onClick={focusDegradedCohort}
              />
            ) : null}
            <StatChip
              label={t("statAwaitingYou")}
              value={approvals.length}
              tone={approvals.length > 0 ? "coral" : "neutral"}
              onClick={() => router.push(buildUrl({ tab: "decisions" }, search.toString()))}
            />
          </div>
        ) : null}
      </header>

      {/* Command line, AI screen, automation pass and the scheduler moved to the
          bottom Control Center (app/features/simulation/ControlDock.tsx) — they're
          workspace-level automation, so the pipeline page stays focused on the
          board and the day's work, not the machinery. */}

      {/* 8f8f578d — candidate-driven work narrated with names + destinations,
          on the landing surface (badges only carry counts). */}
      {entries && entries.length > 0 ? <TodayRail entries={entries} onShowStage={showStage} /> : null}

      {moveError ? (
        <p role="alert" className="flex items-center justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{moveError}</span>
          <button
            type="button"
            onClick={() => setMoveError(null)}
            aria-label={t("moveErrorDismiss")}
            className="focus-ring shrink-0 rounded p-0.5 hover:opacity-70"
          >
            <X size={14} aria-hidden />
          </button>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : entries == null ? (
        <p role="status" className="text-base text-steel">{t("loading")}</p>
      ) : entries.length === 0 ? (
        <ChainEmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          links={[
            { tab: "channels", label: t("emptyCtaChannels") },
            { tab: "profile", label: t("emptyCtaProfile") },
          ]}
          // 5d2e0998 — the empty board is the first-run moment: offer the
          // guided tour (the simulation walks the whole hiring story live).
          extraAction={
            !sim.running ? (
              <button
                type="button"
                onClick={sim.start}
                className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
              >
                <Play size={13} aria-hidden /> {t("emptyCtaTour")}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {degradedCount > 0 ? (
            <button
              type="button"
              onClick={focusDegradedCohort}
              className="focus-ring flex w-full items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left hover:bg-red-100"
            >
              <span className="flex min-w-0 items-center gap-2 text-base text-ink">
                <AlertTriangle size={16} className="shrink-0 text-red-600" aria-hidden />
                <span>
                  <span className="font-semibold text-red-700">{t("degradedBannerCount", { count: degradedCount })}</span>{" "}
                  {t("degradedBannerBody", { count: degradedCount })}
                </span>
              </span>
              <span className="shrink-0 text-base font-semibold text-red-700">{t("review")}</span>
            </button>
          ) : null}

          {approvals.length > 0 ? (
            <button
              type="button"
              onClick={() => router.push(buildUrl({ tab: "decisions" }, search.toString()))}
              className="focus-ring flex w-full items-center justify-between rounded-lg border border-coral/30 bg-coral/5 px-4 py-3 text-left hover:bg-coral/10"
            >
              <span className="text-base text-ink">
                <span className="font-semibold text-coral">{t("approvalsCount", { count: approvals.length })}</span>{" "}
                {t("approvalsBody")}
              </span>
              <span className="text-base font-semibold text-coral">{t("openDecisions")}</span>
            </button>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="pipeline-search" className="sr-only">{t("searchLabel")}</label>
            <TextInput
              id="pipeline-search"
              type="search"
              value={query}
              onChange={(e) => setQueryAndSync(e.target.value)}
              placeholder={t("searchPlaceholder")}
              sizeVariant="sm"
              className="min-w-[200px] flex-1"
            />
            {(
              [
                ["interview", t("filterInterview")],
                ["aging", t("filterAging")],
                ["awaiting", t("filterAwaiting")],
                ["intake", t("filterIntake")],
              ] as [QuickFilter, string][]
            ).map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleQuick(f)}
                aria-pressed={quicks.has(f)}
                className={CHIP_TOGGLE(quicks.has(f))}
              >
                {label}
              </button>
            ))}
            {/* ANA1: the funnel-stage filter arrives via deep link only; while
                active it reads as a pressed chip that a click dismisses. */}
            {stageFilter ? (
              <button
                type="button"
                onClick={clearStageFilter}
                aria-pressed={true}
                title={t("filterStageClear")}
                className={CHIP_TOGGLE(true)}
              >
                {t("filterStage", { stage: enumLabel("stage", stageFilter) })} ×
              </button>
            ) : null}
            {filtering ? (
              <span className="text-sm text-steel" aria-live="polite">
                {t("showingCount", { shown: filteredEntries.length, total: (entries ?? []).length })}
              </span>
            ) : null}
            {filtering ? (
              <button
                type="button"
                onClick={clearFilters}
                className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
              >
                {t("clear")}
              </button>
            ) : null}
            {/* PIPE5: save the current combo as a named view (only when it isn't
                already one). */}
            {filtering && !activeViewId ? (
              <button
                type="button"
                onClick={saveView}
                className="focus-ring inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
              >
                <BookmarkPlus size={13} /> {t("saveView")}
              </button>
            ) : null}
            {/* PIPE1: flip the board's rows into checkboxes for batch actions. */}
            <button
              type="button"
              onClick={toggleSelectMode}
              aria-pressed={selectMode}
              className={`focus-ring ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${
                selectMode ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-ink"
              }`}
            >
              <CheckSquare size={13} /> {selectMode ? t("selectDone") : t("select")}
            </button>
            {/* PIPE4: tune the per-stage aging thresholds for this board. */}
            <button
              type="button"
              onClick={() => setEditingSla((v) => !v)}
              aria-pressed={editingSla}
              className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${
                editingSla ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-ink"
              }`}
              title={t("agingSlasTitle")}
            >
              <Timer size={13} /> {t("agingSlas")}
            </button>
          </div>

          {/* perfect-board — compound facets the single-select quick row can't
              express: a score-range band set (honest tiers consistent with the card
              ScoreBadge; unscored is its own bucket) and, when the board spans more
              than one channel, a source facet — plus a within-lane sort. Bands +
              sources compose OR-within / AND-across; every quick chip AND-composes. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-meta uppercase tracking-wide text-steel">{t("filterScoreLabel")}</span>
              {SCORE_BANDS.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => toggleBand(b)}
                  aria-pressed={scoreBands.has(b)}
                  className={CHIP_TOGGLE(scoreBands.has(b))}
                >
                  {t(
                    b === "strong"
                      ? "filterScoreStrong"
                      : b === "mid"
                        ? "filterScoreMid"
                        : b === "weak"
                          ? "filterScoreWeak"
                          : "filterScoreUnscored"
                  )}
                </button>
              ))}
            </div>
            {sourceValues.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-meta uppercase tracking-wide text-steel">{t("filterSourceLabel")}</span>
                {sourceValues.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSource(s)}
                    aria-pressed={sources.has(s)}
                    className={CHIP_TOGGLE(sources.has(s))}
                  >
                    {channelName(s)}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="ml-auto flex items-center gap-1.5 text-sm font-medium text-steel">
              {t("sortLabel")}
              <Select
                ariaLabel={t("sortLabel")}
                value={sort}
                onChange={(v) => setSortAndSync(v as SortKey)}
                size="sm"
                className="h-8"
                options={[
                  { value: "insertion", label: t("sortInsertion") },
                  { value: "score", label: t("sortScore") },
                  { value: "age", label: t("sortAge") },
                ]}
              />
            </label>
          </div>

          {/* PIPE1: the batch action bar — pairs with the filters above (filter
              to the cohort, select all shown, move them in one pass). */}
          {selectMode ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-3 py-2">
              <span className="text-sm font-semibold text-ink" aria-live="polite">
                {t("selectedCount", { count: selectedIds.size })}
              </span>
              <button
                type="button"
                onClick={selectAllVisible}
                className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
              >
                {t("selectAllVisible", { count: filteredEntries.length })}
              </button>
              {selectedIds.size > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds(new Set());
                    dispatchBulkConfirm({ type: "selectionChanged" });
                  }}
                  className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
                >
                  {t("bulkClear")}
                </button>
              ) : null}
              <label className="ml-auto flex items-center gap-1.5 text-sm font-medium text-steel">
                {t("bulkMoveLabel")}
                <Select
                  ariaLabel={t("bulkMoveLabel")}
                  value={bulkStage}
                  onChange={setBulkStage}
                  size="sm"
                  className="h-8"
                  options={[{ value: "", label: "—" }, ...STAGES.map((s) => ({ value: s, label: enumLabel("stage", s) }))]}
                />
              </label>
              <button
                type="button"
                onClick={() => void bulkMove()}
                disabled={bulkBusy || !bulkStage || selectedIds.size === 0}
                className="focus-ring rounded-md bg-coral px-3 py-1 text-sm font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
              >
                {bulkBusy ? t("bulkMoving") : t("bulkApply", { count: selectedIds.size })}
              </button>
              {/* P2-2 — send self-scheduling links to the selected active cohort. */}
              {selectedActive.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void bulkInvite()}
                  disabled={bulkBusy}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
                >
                  <CalendarClock size={13} aria-hidden /> {t("bulkInvite", { count: selectedActive.length })}
                </button>
              ) : null}
              {/* Draft tailored outreach for the whole active cohort at once — the same
                  per-candidate action the drawer offers, batched. Backgrounded: the
                  drafts land in the Outbox to review + release. With NO relay that is
                  terminal (nothing sends); with a relay configured dispatchOutreach
                  relays each letter immediately, so "draft N" IS "send N" — the click
                  arms a two-step confirm in that case (unknown capability fails safe). */}
              {selectedActive.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (relayConfigured !== false && !confirmingBulkOutreach) {
                        dispatchBulkConfirm({ type: "arm", which: "outreach" });
                        return;
                      }
                      void bulkOutreach();
                    }}
                    disabled={bulkBusy || outreachTask.active}
                    className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-semibold disabled:opacity-50 ${
                      confirmingBulkOutreach
                        ? "border-dial-amber/50 bg-dial-amber/15 text-ink hover:bg-dial-amber/25"
                        : "border-stone-200 bg-white text-ink hover:border-coral/40"
                    }`}
                  >
                    <Mail size={13} aria-hidden />{" "}
                    {outreachTask.active
                      ? t("bulkDrafting")
                      : confirmingBulkOutreach
                        ? t("bulkDraftOutreachConfirm", { count: selectedActive.length })
                        : t("bulkDraftOutreach", { count: selectedActive.length })}
                  </button>
                  {/* Explicit back-out for the armed confirm, mirroring the reject
                      confirm's Yes/Cancel idiom (a lone toggling button gave the
                      recruiter no way to disarm without changing the selection). */}
                  {confirmingBulkOutreach ? (
                    <button
                      type="button"
                      onClick={() => dispatchBulkConfirm({ type: "cancel" })}
                      disabled={bulkBusy}
                      className="focus-ring rounded-md px-2 py-1 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
                    >
                      {t("bulkRejectCancel")}
                    </button>
                  ) : null}
                </span>
              ) : null}
              {bulkResult ? (
                <span role="status" className="text-sm">
                  <span className="font-semibold text-moss">
                    {t(
                      bulkResult.verb === "moved"
                        ? "bulkMoved"
                        : bulkResult.verb === "accepted"
                          ? "bulkAccepted"
                          : bulkResult.verb === "invited"
                            ? relayConfigured === false
                              ? "bulkInvitedQueued"
                              : "bulkInvited"
                            : bulkResult.verb === "drafted"
                              ? relayConfigured === false
                                ? "bulkDraftedQueued"
                                : "bulkDrafted"
                              : "bulkRejected",
                      { count: bulkResult.ok }
                    )}
                  </span>
                  {bulkResult.failed > 0 ? (
                    <span className="font-semibold text-coral">
                      {" · "}
                      {t(bulkResult.verb === "drafted" ? "bulkDraftFailed" : "bulkFailed", { count: bulkResult.failed })}
                    </span>
                  ) : null}
                  {/* The server's own reason for the refusals (409 concurrency vs
                      422 forbidden transition), verbatim — so a bulk failure says
                      WHY and what to do, not just a count. */}
                  {bulkResult.reason ? <span className="block text-steel">{bulkResult.reason}</span> : null}
                </span>
              ) : null}
              {/* bdc7fc01 — accept/reject the awaiting cohort in one pass. Only the
                  selected entries that need a human decision are actionable; the
                  per-kind breakdown makes a mixed selection obvious before acting. */}
              {selectedAwaiting.length > 0 ? (
                <div className="flex w-full flex-wrap items-center gap-2 border-t border-coral/20 pt-2">
                  <span className="text-sm text-steel">
                    {t("bulkAwaiting", { count: selectedAwaiting.length })}
                    {awaitingKinds.length > 0 ? (
                      <span className="text-stone-400">
                        {" · "}
                        {awaitingKinds.map(([k, n]) => `${n} ${enumLabel("approvalKind", k)}`).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => void bulkDecide("accept")}
                    disabled={bulkBusy}
                    className="focus-ring ml-auto rounded-md bg-moss px-3 py-1 text-sm font-semibold text-white hover:bg-moss/90 disabled:opacity-50"
                  >
                    {t("bulkAccept", { count: selectedAwaiting.length })}
                  </button>
                  {confirmingBulkReject ? (
                    <>
                      <span className="text-sm font-semibold text-coral">
                        {t("bulkRejectConfirm", { count: selectedAwaiting.length })}
                      </span>
                      <button
                        type="button"
                        onClick={() => void bulkDecide("reject")}
                        disabled={bulkBusy}
                        className="focus-ring rounded-md bg-coral px-3 py-1 text-sm font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
                      >
                        {bulkBusy ? t("bulkMoving") : t("bulkRejectConfirmYes")}
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatchBulkConfirm({ type: "cancel" })}
                        disabled={bulkBusy}
                        className="focus-ring rounded-md px-2 py-1 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
                      >
                        {t("bulkRejectCancel")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => dispatchBulkConfirm({ type: "arm", which: "reject" })}
                      disabled={bulkBusy}
                      className="focus-ring rounded-md border border-coral/40 bg-white px-3 py-1 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                    >
                      {t("bulkReject", { count: selectedAwaiting.length })}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {editingSla ? (
            <div className="flex flex-wrap items-end gap-3 rounded-md border border-stone-200 bg-paper px-3 py-2">
              <span className="text-meta uppercase tracking-wide text-steel">{t("slaEditorTitle")}</span>
              {STAGES.filter((s) => s !== "Hired").map((stage) => (
                <label key={stage} className="flex flex-col text-meta text-steel">
                  {enumLabel("stage", stage)}
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={slaOverrides[stage] ?? ""}
                    placeholder={String(STAGE_SLA_DEFAULTS[stage] ?? "")}
                    onChange={(ev) => {
                      const n = parseInt(ev.target.value, 10);
                      setStageSla(stage, Number.isFinite(n) ? n : null);
                    }}
                    className="focus-ring mt-0.5 h-8 w-16 rounded-md border border-stone-200 bg-white px-2 text-sm nums text-ink caret-coral"
                  />
                </label>
              ))}
              <span className="text-meta text-steel">{t("slaEditorNote")}</span>
            </div>
          ) : null}

          {views.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-meta uppercase tracking-wide text-steel">{t("views")}</span>
              {views.map((v) => (
                <span
                  key={v.id}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${
                    activeViewId === v.id ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel"
                  }`}
                >
                  <button type="button" onClick={() => applyView(v)} className="focus-ring rounded hover:text-ink" title={t("applyView")}>
                    {v.name}
                  </button>
                  {/* PIPE3: the view as a pasteable link — localStorage views
                      can't travel; the URL can. */}
                  <button
                    type="button"
                    onClick={() => void copyViewLink(v)}
                    aria-label={t("copyViewLink", { name: v.name })}
                    title={copiedViewId === v.id ? t("viewLinkCopied") : t("copyViewLinkTitle")}
                    className={`focus-ring rounded ${copiedViewId === v.id ? "text-moss" : "text-steel hover:text-ink"}`}
                  >
                    <Link2 size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteView(v.id)}
                    aria-label={t("deleteView", { name: v.name })}
                    title={t("deleteViewTitle")}
                    className="focus-ring -mr-0.5 rounded text-steel hover:text-coral"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {filtering && filteredEntries.length === 0 ? (
            <p className="rounded-lg border border-stone-200 bg-paper p-4 text-base text-steel">
              {t("noMatch")}{" "}
              <button type="button" onClick={clearFilters} className="font-semibold text-coral underline underline-offset-2">
                {t("clearFilters")}
              </button>
            </p>
          ) : (
            <div data-sim="pipeline-board">
              <PipelineBoard
                positions={boardPositions}
                entries={filteredEntries}
                isStale={isStale}
                openPositionRanking={openPositionRanking}
                openProfile={openProfile}
                openJob={openJob}
                openActions={openActions}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelected}
                onMove={moveEntry}
              />
            </div>
          )}

          {eventsError || events.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-meta uppercase tracking-wide text-steel">{t("activity")}</h3>
              {/* A failed events fetch shows a low-key note so a broken feed is
                  observable and never masquerades as "no activity yet". */}
              {eventsError ? (
                <p role="status" className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
                  <AlertTriangle size={14} className="shrink-0" aria-hidden /> {eventsError}
                </p>
              ) : null}
              {events.length > 0 ? (
                <ol className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white shadow-panel">
                  {events.slice(0, 12).map((ev) => (
                    <li key={ev.id} className="flex items-center gap-3 px-3 py-2 text-base">
                      <EventDot kind={ev.kind} />
                      <span className="min-w-0 flex-1 truncate text-ink">
                        <span className="font-medium">{ev.candidateLabel ?? t("candidateFallback")}</span>{" "}
                        <span className="text-steel">{eventVerb(ev)}</span>{" "}
                        {ev.jobTitle ? <span className="text-steel">· {ev.jobTitle}</span> : null}
                      </span>
                      <span className="shrink-0 text-sm text-steel">{relativeTime(ev.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      {drawerEntry ? (
        // key on the entry id so switching candidates remounts the drawer, resetting
        // its per-entry result/notes/busy/token-link state instead of briefly showing
        // the previous candidate's.
        <CandidateDrawer
          key={drawerEntry.id}
          entry={drawerEntry}
          onClose={() => setDrawerEntry(null)}
          onChanged={load}
          onOpenEntry={openEntryById}
          cohort={filteredEntries}
          onNavigate={setDrawerEntry}
        />
      ) : null}
    </div>
  );
}

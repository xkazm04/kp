"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BookmarkPlus, CalendarClock, CheckSquare, Link2, Play, Sparkles, Timer, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { useSimulation } from "@/app/features/simulation/SimulationProvider";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { useLiveRefresh } from "@/app/features/live-refresh";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { CHIP_TOGGLE, EYEBROW, INTRO, PAGE_HEADER, SECTION, STAT, STAT_LABEL, STAT_VALUE, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { CandidateDrawer } from "./CandidateDrawer";
import { PassPreviewModal } from "./PassPreviewModal";
import { PipelineBoard } from "./PipelineBoard";
import { CommandBar } from "./CommandBar";
import { SchedulerControl } from "./SchedulerControl";
import { EventDot, useEventVerb, useRelativeTime } from "./PipelineShared";
import { TodayRail } from "./TodayRail";
import { recordRecent } from "@/app/features/recents";
import { postPipelineAction } from "@/app/_lib/useAddToPipeline";
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

// The board's quick-filter toggles (free-text name/role search runs alongside).
// Canonical value list so the ?quick= deep-link param (ANA1) validates against
// the same set the chips render from.
const QUICK_FILTERS = ["interview", "aging", "awaiting", "intake"] as const;
type QuickFilter = (typeof QUICK_FILTERS)[number];

// A saved board view (PIPE5): a named snapshot of the search + quick-filter.
type SavedView = { id: string; name: string; query: string; quick: QuickFilter | null };
const PIPELINE_VIEWS_KEY = "kp.pipelineViews";
const PIPELINE_SLA_KEY = "kp.pipelineStageSla"; // per-stage aging overrides (PIPE4)

export function PipelineTab() {
  const router = useRouter();
  const search = useSearchParams();
  const t = useTranslations("pipeline.tab");
  const enumLabel = useEnumLabel();
  const eventVerb = useEventVerb();
  const relativeTime = useRelativeTime();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Activity-feed health is tracked separately from the board: a failed events
  // fetch must read as "couldn't load activity", never as a genuine empty feed.
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [passSummary, setPassSummary] = useState<{
    advanced: number;
    rejected: number;
    held: number;
    alerts: number;
  } | null>(null);
  // AUTO3 — the dry-run preview the "Run pass" button now opens before anything
  // commits (mirrors the screening wave's DEC2 gate: the pass auto-rejects AND
  // emails candidates, so it gets the same look-before-commit grammar).
  const [preview, setPreview] = useState<{
    summary: { advanced: number; rejected: number; held: number; alerts: number; errors: number; evaluated: number };
    decisions: { entryId: string; action: string; toStage: string | null; reason: string }[];
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [drawerEntry, setDrawerEntry] = useState<Entry | null>(null);
  // Board search/filter (PIPE2): a free-text candidate/role query + one active
  // quick-filter chip. Client-side — the board already holds every entry.
  // ANA1: state hydrates from the URL ONCE at mount (lazy initializers off the
  // render-time searchParams) so analytics deep links (?q=/?quick=/?stage=)
  // land pre-filtered — the tab unmounts on every switch, so each navigation
  // re-reads them. In-board filter edits intentionally do NOT write back to the
  // URL (shareable view URLs are their own finding, PIPE3 in the 06-10 scan).
  const [query, setQuery] = useState(() => search.get("q") ?? "");
  const [quick, setQuick] = useState<QuickFilter | null>(() => {
    const v = search.get("quick");
    return v && (QUICK_FILTERS as readonly string[]).includes(v) ? (v as QuickFilter) : null;
  });
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
  const [bulkResult, setBulkResult] = useState<{ ok: number; failed: number; verb: "moved" | "accepted" | "rejected" | "invited" } | null>(null);
  // Two-step confirm for bulk reject (it emails N candidates — irreversible).
  const [confirmingBulkReject, setConfirmingBulkReject] = useState(false);
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
  const { startTask, findActive, tasks } = useTasks();
  // 5d2e0998 — the empty board offers the guided tour (simulation start).
  const sim = useSimulation();
  const batch = findActive((t) => t.kind === "batch_screen");
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
        setEntries((p.entries as Entry[]) ?? []);
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
          setEvents(incoming); // initial page, newest-first
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

  // Board search + quick-filter (PIPE2). The summary StatChips above stay full
  // totals; only the board (its lanes + cards) narrows. boardPositions drops lanes
  // with no surviving candidate so a name search doesn't leave empty columns.
  const q = query.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    return (entries ?? []).filter((e) => {
      const hitQuery =
        !q || (e.candidateLabel ?? "").toLowerCase().includes(q) || (e.jobTitle ?? "").toLowerCase().includes(q);
      if (!hitQuery) return false;
      if (stageFilter && e.stage !== stageFilter) return false;
      switch (quick) {
        case "aging":
          return e.stage !== "Hired" && (daysSince(e.stageChangedAt) ?? 0) >= slaForStage(e.stage, slaOverrides);
        case "awaiting":
          return needsHumanDecision(e.approvalKind) && e.status === "active";
        case "intake":
          return e.intakeDegraded && e.status !== "rejected";
        case "interview":
          return e.stage === "Interview";
        default:
          return true;
      }
    });
  }, [entries, q, quick, stageFilter, slaOverrides]);

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
  const filtering = Boolean(q) || quick !== null || stageFilter !== null;

  // PIPE3 — two-way URL sync: filter changes write back to the same ?q/?quick/
  // ?stage params the mount hydration (ANA1) reads, so the board's view state
  // is always a pasteable, bookmarkable URL. router.replace (no history spam);
  // typing debounces, chip clicks write immediately. Closes W9-1's deliberate
  // write-back deferral.
  const urlSyncTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (urlSyncTimer.current != null) window.clearTimeout(urlSyncTimer.current);
  }, []);
  const writeFiltersToUrl = (next: { q: string; quick: QuickFilter | null; stage: string | null }, debounceMs = 0) => {
    const apply = () =>
      router.replace(
        buildUrl({ q: next.q.trim() || null, quick: next.quick, stage: next.stage }, search.toString()),
        { scroll: false }
      );
    if (urlSyncTimer.current != null) window.clearTimeout(urlSyncTimer.current);
    if (debounceMs > 0) urlSyncTimer.current = window.setTimeout(apply, debounceMs);
    else apply();
  };
  const setQueryAndSync = (value: string) => {
    setQuery(value);
    writeFiltersToUrl({ q: value, quick, stage: stageFilter }, 400);
  };
  const toggleQuick = (f: QuickFilter) => {
    const next = quick === f ? null : f;
    setQuick(next);
    writeFiltersToUrl({ q: query, quick: next, stage: stageFilter });
  };
  const clearStageFilter = () => {
    setStageFilter(null);
    writeFiltersToUrl({ q: query, quick, stage: null });
  };
  // Today rail → board: focus on one stage, clearing the other filters so the
  // board shows exactly the cohort the rail row counted.
  const showStage = (stage: string) => {
    setQuery("");
    setQuick(null);
    setStageFilter(stage);
    writeFiltersToUrl({ q: "", quick: null, stage });
  };
  const clearFilters = () => {
    setQuery("");
    setQuick(null);
    setStageFilter(null);
    writeFiltersToUrl({ q: "", quick: null, stage: null });
  };
  // PIPE3 — a saved view as a pasteable link: built from a CLEAN query string
  // (not the current one) so the share never drags along unrelated params.
  const [copiedViewId, setCopiedViewId] = useState<string | null>(null);
  const copyViewLink = async (v: SavedView) => {
    const href = `${window.location.origin}${buildUrl({ tab: "pipeline", q: v.query.trim() || null, quick: v.quick }, "")}`;
    if (await copyText(href)) {
      setCopiedViewId(v.id);
      window.setTimeout(() => setCopiedViewId((cur) => (cur === v.id ? null : cur)), 2000);
    }
  };
  // PIPE5 — save the current filter combo as a named view, apply one, or drop it.
  const activeViewId = views.find((v) => v.query === query && v.quick === quick)?.id ?? null;
  const saveView = () => {
    const suggested = query.trim() || (quick ? quick : "view");
    const name = window.prompt(t("saveViewPrompt"), suggested)?.trim();
    if (!name) return;
    persistViews([...views.filter((v) => v.name !== name), { id: name, name, query, quick }]);
  };
  const applyView = (v: SavedView) => {
    setQuery(v.query);
    setQuick(v.quick);
    writeFiltersToUrl({ q: v.query, quick: v.quick, stage: stageFilter });
  };
  const deleteView = (id: string) => persistViews(views.filter((v) => v.id !== id));

  // PIPE1 — bulk move. Sequential set_stage POSTs, each carrying its OWN
  // expectedStage (the stage the board showed for THAT card) — a 409 means a
  // concurrent actor moved that candidate, and the MatrixTab W11 grammar
  // applies: the failure STAYS SELECTED for retry while successes deselect.
  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
    setBulkResult(null);
    setConfirmingBulkReject(false);
  };
  const toggleSelected = (e: Entry) => {
    setBulkResult(null);
    setConfirmingBulkReject(false);
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(e.id)) next.delete(e.id);
      else next.add(e.id);
      return next;
    });
  };
  const selectAllVisible = () => {
    setBulkResult(null);
    setConfirmingBulkReject(false);
    setSelectedIds(new Set(filteredEntries.map((e) => e.id)));
  };
  const bulkMove = async () => {
    if (!bulkStage || selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkResult(null);
    let moved = 0;
    const failures = new Set<string>();
    for (const id of selectedIds) {
      const entry = (entries ?? []).find((x) => x.id === id);
      if (!entry) continue; // vanished since selection — nothing left to move
      if (entry.stage === bulkStage) {
        moved += 1; // already at the target — done, deselect
        continue;
      }
      try {
        const r = await postPipelineAction(id, { action: "set_stage", toStage: bulkStage, expectedStage: entry.stage });
        if (r.ok) moved += 1;
        else failures.add(id);
      } catch {
        failures.add(id);
      }
    }
    setSelectedIds(failures);
    setBulkResult({ ok: moved, failed: failures.size, verb: "moved" });
    setBulkBusy(false);
    await load();
  };

  // bdc7fc01 — bulk accept/reject the AWAITING cohort in the selection. Acts only
  // on selected entries that need a human decision (others have nothing to decide
  // and are left selected, untouched). Each carries its OWN expectedStage so a
  // concurrent move is a 409 that STAYS SELECTED for retry — same grammar as
  // bulkMove. A bulk reject emails everyone, so it's confirm-gated in the UI.
  const bulkDecide = async (action: "accept" | "reject") => {
    const awaiting = [...selectedIds]
      .map((id) => (entries ?? []).find((x) => x.id === id))
      .filter((e): e is Entry => !!e && needsHumanDecision(e.approvalKind) && e.status === "active");
    if (awaiting.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkResult(null);
    setConfirmingBulkReject(false);
    let ok = 0;
    const failed = new Set<string>();
    for (const e of awaiting) {
      try {
        const r = await postPipelineAction(e.id, { action, expectedStage: e.stage });
        if (r.ok) ok += 1;
        else failed.add(e.id);
      } catch {
        failed.add(e.id);
      }
    }
    // Successes deselect; failures + any selected non-awaiting entries stay selected.
    const untouched = [...selectedIds].filter((id) => !awaiting.some((e) => e.id === id));
    setSelectedIds(new Set([...failed, ...untouched]));
    setBulkResult({ ok, failed: failed.size, verb: action === "accept" ? "accepted" : "rejected" });
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
    setConfirmingBulkReject(false);
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
    try {
      const r = await postPipelineAction(entry.id, { action: "set_stage", toStage, expectedStage: prevStage });
      if (!r.ok) restage(entry.id, prevStage);
    } catch {
      restage(entry.id, prevStage);
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

  // AUTO3 — "Run pass" opens a preview first: identical decisions, nothing
  // applied, no candidate emailed. The commit happens only from the modal.
  const previewPass = async () => {
    setPreviewing(true);
    setPassSummary(null);
    try {
      const r = await fetch("/api/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const p = await r.json().catch(() => null);
      if (r.ok && p) {
        setError(null);
        setPreview({ summary: p.summary, decisions: p.decisions ?? [] });
      } else {
        setError(t("passFailed"));
      }
    } catch {
      setError(t("passFailedNetwork"));
    } finally {
      setPreviewing(false);
    }
  };

  const runPass = async () => {
    setRunning(true);
    setPassSummary(null);
    try {
      const r = await fetch("/api/automation/run", { method: "POST" });
      const p = await r.json().catch(() => null);
      if (r.ok) {
        setError(null); // a clean pass clears any prior transient error
        setPassSummary(p.summary);
        setPreview(null);
        load();
      } else {
        // A failing pass used to read identically to a successful no-op (empty
        // else, no catch) — the operator believed the funnel was processed.
        setError(t("passFailed"));
      }
    } catch {
      setError(t("passFailedNetwork"));
    } finally {
      setRunning(false);
    }
  };

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
                onClick={() => setDrawerEntry(degraded[0])}
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

      {/* NL command bar (#7): type an action over the board; preview-then-confirm. */}
      <CommandBar onExecuted={load} />

      {/* One action row: the manual triggers sit alongside the Automation clock. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => startTask("batch_screen")}
          disabled={!!batch}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-coral bg-coral/10 px-3 text-base font-semibold text-coral transition-colors hover:bg-coral/15 disabled:opacity-60"
          title={t("batchTitle")}
        >
          <Sparkles size={14} />
          {batch ? t("batchScreening", { done: batch.progressDone, total: batch.progressTotal }) : t("batchScreenAll")}
        </button>
        <button
          type="button"
          onClick={previewPass}
          disabled={running || previewing}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
          title={t("runPassTitle")}
        >
          {previewing ? t("previewingPass") : running ? t("runningPass") : t("runPass")}
        </button>
        <SchedulerControl
          onRan={load}
          className="flex-1 min-w-[20rem]"
          labelFor={(entryId) => entries?.find((e) => e.id === entryId)?.candidateLabel}
        />
      </div>

      {/* 8f8f578d — candidate-driven work narrated with names + destinations,
          on the landing surface (badges only carry counts). */}
      {entries && entries.length > 0 ? <TodayRail entries={entries} onShowStage={showStage} /> : null}

      {passSummary ? (
        <div className="animate-fade-in rounded-md border border-moss/30 bg-moss/5 px-4 py-2 text-base text-ink">
          {t("passSummaryLead")} · <span className="font-semibold text-moss">{t("passAdvanced", { n: passSummary.advanced })}</span> ·{" "}
          <span className="font-semibold">{t("passRejected", { n: passSummary.rejected })}</span> · {t("passHeld", { n: passSummary.held })} ·{" "}
          {t("passAlerts", { n: passSummary.alerts })}{" "}
          <span className="text-steel">{t("passEarlyCareer")}</span>
        </div>
      ) : null}

      {preview ? (
        <PassPreviewModal
          preview={preview}
          entries={entries ?? []}
          committing={running}
          onCommit={runPass}
          onClose={() => setPreview(null)}
        />
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
              onClick={() => setDrawerEntry(degraded[0])}
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
            <input
              id="pipeline-search"
              type="search"
              value={query}
              onChange={(e) => setQueryAndSync(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="focus-ring h-9 min-w-[200px] flex-1 rounded-md border border-stone-200 px-3 text-base"
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
                aria-pressed={quick === f}
                className={CHIP_TOGGLE(quick === f)}
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
                    setConfirmingBulkReject(false);
                  }}
                  className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
                >
                  {t("bulkClear")}
                </button>
              ) : null}
              <label className="ml-auto flex items-center gap-1.5 text-sm font-medium text-steel">
                {t("bulkMoveLabel")}
                <select
                  value={bulkStage}
                  onChange={(ev) => setBulkStage(ev.target.value)}
                  className="focus-ring h-8 rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
                >
                  <option value="">—</option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {enumLabel("stage", s)}
                    </option>
                  ))}
                </select>
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
              {bulkResult ? (
                <span role="status" className="text-sm">
                  <span className="font-semibold text-moss">
                    {t(
                      bulkResult.verb === "moved"
                        ? "bulkMoved"
                        : bulkResult.verb === "accepted"
                          ? "bulkAccepted"
                          : bulkResult.verb === "invited"
                            ? "bulkInvited"
                            : "bulkRejected",
                      { count: bulkResult.ok }
                    )}
                  </span>
                  {bulkResult.failed > 0 ? (
                    <span className="font-semibold text-coral"> · {t("bulkFailed", { count: bulkResult.failed })}</span>
                  ) : null}
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
                        onClick={() => setConfirmingBulkReject(false)}
                        disabled={bulkBusy}
                        className="focus-ring rounded-md px-2 py-1 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
                      >
                        {t("bulkRejectCancel")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingBulkReject(true)}
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
                    className="focus-ring mt-0.5 h-8 w-16 rounded-md border border-stone-200 px-2 text-sm nums text-ink"
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
        <CandidateDrawer key={drawerEntry.id} entry={drawerEntry} onClose={() => setDrawerEntry(null)} onChanged={load} />
      ) : null}
    </div>
  );
}

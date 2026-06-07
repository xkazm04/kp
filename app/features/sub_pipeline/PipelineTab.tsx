"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Sparkles } from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { useLiveRefresh } from "@/app/features/live-refresh";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { CandidateDrawer } from "./CandidateDrawer";
import { PipelineBoard } from "./PipelineBoard";
import { SchedulerControl } from "./SchedulerControl";
import { EventDot, eventVerb } from "./PipelineShared";
import { daysSince, relativeTime, STALE_DAYS, type Entry, type PipelineEvent } from "./PipelineTypes";

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
  const cls = "flex min-w-[5rem] flex-col items-center gap-0.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 shadow-panel";
  const inner = (
    <>
      <span className="text-micro uppercase tracking-wide text-steel">{label}</span>
      <span className={`font-serif text-xl leading-none ${valueColor}`}>{value}</span>
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

export function PipelineTab() {
  const router = useRouter();
  const search = useSearchParams();
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
  const [drawerEntry, setDrawerEntry] = useState<Entry | null>(null);
  const { startTask, findActive, tasks } = useTasks();
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
        setError(e instanceof Error ? e.message : "Failed to load pipeline.");
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
        setEventsError("Couldn't load recent activity.");
      });
  }, []);
  useEffect(() => {
    load();
    return () => abortRef.current?.abort(); // drop in-flight fetches on unmount
  }, [load]);
  useLiveRefresh(load); // re-fetch the board live when the simulation (or any actor) changes state

  const positions = useMemo(() => {
    const map = new Map<string, { id: string; title: string; family: string; count: number }>();
    for (const e of entries ?? []) {
      const key = e.jobId ?? e.jobTitle ?? "?";
      if (!map.has(key)) map.set(key, { id: key, title: e.jobTitle ?? "—", family: e.roleFamily ?? "", count: 0 });
      map.get(key)!.count += 1;
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [entries]);

  const approvals = (entries ?? []).filter((e) => needsHumanDecision(e.approvalKind) && e.status === "active");
  const activeCount = (entries ?? []).filter((e) => e.stage !== "Hired").length;
  const interviewCount = (entries ?? []).filter((e) => e.stage === "Interview").length;
  const isStale = (e: Entry) => e.stage !== "Hired" && (daysSince(e.stageChangedAt) ?? 0) >= STALE_DAYS;
  const staleCount = (entries ?? []).filter(isStale).length;
  // Stubs from a failed intake normalization: visible, recoverable, and not yet
  // matchable until a recruiter captures the profile. Active-only — a rejected
  // stub is out of the funnel and doesn't need recovery.
  const degraded = (entries ?? []).filter((e) => e.intakeDegraded && e.status !== "rejected");
  const degradedCount = degraded.length;

  const openActions = (e: Entry) => setDrawerEntry(e);
  // Candidate name → the analyzed profile (Match view); falls back to the
  // AI-actions drawer when the entry has no linked candidate id.
  const openProfile = (e: Entry) =>
    e.candidateId ? router.push(buildUrl({ tab: "match", profile: e.candidateId }, search.toString())) : setDrawerEntry(e);
  const openJob = (jobId: string) => router.push(buildUrl({ tab: "jobs", job: jobId }, search.toString()));

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

  const runPass = async () => {
    setRunning(true);
    setPassSummary(null);
    try {
      const r = await fetch("/api/automation/run", { method: "POST" });
      const p = await r.json();
      if (r.ok) {
        setPassSummary(p.summary);
        load();
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="stagger-children space-y-6" aria-busy={entries == null}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">Pipeline</p>
          <h2 className="mt-1 font-serif text-display text-ink">Hiring pipeline</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            Live view of candidates moving through open positions. Items that need a human decision
            surface at the top — approve or reject, or confirm a proposed interview slot.
          </p>
        </div>
        {entries && entries.length > 0 ? (
          <div className="flex flex-wrap items-stretch gap-1.5">
            <StatChip label="Positions" value={positions.length} />
            <StatChip label="Active" value={activeCount} />
            <StatChip label="Interview" value={interviewCount} />
            <StatChip label={`Aging>${STALE_DAYS}d`} value={staleCount} tone={staleCount > 0 ? "amber" : "neutral"} />
            {degradedCount > 0 ? (
              <StatChip
                label="Needs intake"
                value={degradedCount}
                tone="red"
                onClick={() => setDrawerEntry(degraded[0])}
              />
            ) : null}
            <StatChip
              label="Awaiting you"
              value={approvals.length}
              tone={approvals.length > 0 ? "coral" : "neutral"}
              onClick={() => router.push(buildUrl({ tab: "decisions" }, search.toString()))}
            />
          </div>
        ) : null}
      </header>

      {/* One action row: the manual triggers sit alongside the Automation clock. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => startTask("batch_screen")}
          disabled={!!batch}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 text-base font-semibold text-coral hover:bg-coral/10 disabled:opacity-60"
          title="Background LLM task: screen every matched candidate (runs for minutes; keeps going as you navigate; survives refresh)"
        >
          <Sparkles size={14} />
          {batch ? `Screening ${batch.progressDone}/${batch.progressTotal}…` : "AI-screen all matched"}
        </button>
        <button
          type="button"
          onClick={runPass}
          disabled={running}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
          title="Deterministic policy pass: auto-advance strong BAU matches, hold early-career for a human, flag aging"
        >
          {running ? "Running pass…" : "▷ Run automation pass"}
        </button>
        <SchedulerControl onRan={load} className="flex-1 min-w-[20rem]" />
      </div>

      {passSummary ? (
        <div className="animate-fade-in rounded-md border border-moss/30 bg-moss/5 px-4 py-2 text-base text-ink">
          Automation pass · <span className="font-semibold text-moss">{passSummary.advanced} advanced</span> ·{" "}
          <span className="font-semibold">{passSummary.rejected} rejected</span> · {passSummary.held} held for review ·{" "}
          {passSummary.alerts} aging alerts logged.{" "}
          <span className="text-steel">Early-career candidates are always held for a human.</span>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : entries == null ? (
        <p role="status" className="text-base text-steel">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-paper p-4 text-base text-steel">
          No candidates in the pipeline yet. Seed the candidate population and pipeline (see the data-population
          step), or build a profile and match it.
        </p>
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
                  <span className="font-semibold text-red-700">{degradedCount} application{degradedCount === 1 ? "" : "s"}</span>{" "}
                  couldn&apos;t be auto-profiled and {degradedCount === 1 ? "is" : "are"} a non-matchable stub — capture
                  the profile manually so they re-enter matching.
                </span>
              </span>
              <span className="shrink-0 text-base font-semibold text-red-700">Review →</span>
            </button>
          ) : null}

          {approvals.length > 0 ? (
            <button
              type="button"
              onClick={() => router.push(buildUrl({ tab: "decisions" }, search.toString()))}
              className="focus-ring flex w-full items-center justify-between rounded-lg border border-coral/30 bg-coral/5 px-4 py-3 text-left hover:bg-coral/10"
            >
              <span className="text-base text-ink">
                <span className="font-semibold text-coral">{approvals.length} candidates</span> need your decision —
                advance, reject, or confirm an interview slot.
              </span>
              <span className="text-base font-semibold text-coral">Open Decisions →</span>
            </button>
          ) : null}

          <div data-sim="pipeline-board">
            <PipelineBoard
              positions={positions}
              entries={entries ?? []}
              isStale={isStale}
              openPositionRanking={openPositionRanking}
              openProfile={openProfile}
              openJob={openJob}
              openActions={openActions}
            />
          </div>

          {eventsError || events.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-meta uppercase tracking-wide text-steel">Activity</h3>
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
                        <span className="font-medium">{ev.candidateLabel ?? "Candidate"}</span>{" "}
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
        <CandidateDrawer entry={drawerEntry} onClose={() => setDrawerEntry(null)} onChanged={load} />
      ) : null}
    </div>
  );
}

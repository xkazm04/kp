"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Check, Clock, Sparkles, TimerReset, Users } from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { CandidateDrawer } from "./CandidateDrawer";
import { PipelineBoard } from "./PipelineBoard";
import { SchedulerControl } from "./SchedulerControl";
import { EventDot, eventVerb, Kpi } from "./PipelineShared";
import { daysSince, relativeTime, STALE_DAYS, type Entry, type PipelineEvent } from "./PipelineTypes";

export function PipelineTab() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
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

  const load = () => {
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setEntries((p.entries as Entry[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load pipeline."));
    fetch("/api/pipeline/events")
      .then((r) => r.json())
      .then((p) => setEvents((p.events as PipelineEvent[]) ?? []))
      .catch(() => undefined);
  };
  useEffect(() => {
    load();
  }, []);

  const positions = useMemo(() => {
    const map = new Map<string, { id: string; title: string; family: string; count: number }>();
    for (const e of entries ?? []) {
      const key = e.jobId ?? e.jobTitle ?? "?";
      if (!map.has(key)) map.set(key, { id: key, title: e.jobTitle ?? "—", family: e.roleFamily ?? "", count: 0 });
      map.get(key)!.count += 1;
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [entries]);

  const approvals = (entries ?? []).filter((e) => e.approvalKind && e.status === "active");
  const activeCount = (entries ?? []).filter((e) => e.stage !== "Hired").length;
  const interviewCount = (entries ?? []).filter((e) => e.stage === "Interview").length;
  const isStale = (e: Entry) => e.stage !== "Hired" && (daysSince(e.stageChangedAt) ?? 0) >= STALE_DAYS;
  const staleCount = (entries ?? []).filter(isStale).length;

  const openActions = (e: Entry) => setDrawerEntry(e);
  // Candidate name → the analyzed profile (Match view); falls back to the
  // AI-actions drawer when the entry has no linked candidate id.
  const openProfile = (e: Entry) =>
    e.candidateId ? router.push(buildUrl({ tab: "match", profile: e.candidateId })) : setDrawerEntry(e);
  const openJob = (jobId: string) => router.push(buildUrl({ tab: "jobs", job: jobId }));

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
  const openPositionRanking = (jobId: string) => router.push(buildUrl({ tab: "matrix", job: jobId }));

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
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">Pipeline</p>
          <h2 className="mt-1 font-serif text-display text-ink">Hiring pipeline</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            Live view of candidates moving through open positions. Items that need a human decision
            surface at the top — approve or reject, or confirm a proposed interview slot.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => startTask("batch_screen")}
              disabled={!!batch}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 text-base font-semibold text-coral hover:bg-coral/10 disabled:opacity-60"
              title="Background LLM task: screen every AI-matched candidate (runs for minutes; keeps going as you navigate; survives refresh)"
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
          </div>
          <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
            Seeded demo pipeline · {(entries ?? []).length} candidates
          </span>
        </div>
      </header>

      <SchedulerControl onRan={load} />

      {passSummary ? (
        <div className="animate-fade-in rounded-md border border-moss/30 bg-moss/5 px-4 py-2 text-base text-ink">
          Automation pass · <span className="font-semibold text-moss">{passSummary.advanced} advanced</span> ·{" "}
          <span className="font-semibold">{passSummary.rejected} rejected</span> · {passSummary.held} held for review ·{" "}
          {passSummary.alerts} aging alerts logged.{" "}
          <span className="text-steel">Early-career candidates are always held for a human.</span>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : entries == null ? (
        <p className="text-base text-steel">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-paper p-4 text-base text-steel">
          No candidates in the pipeline yet. Seed the candidate population and pipeline (see the data-population
          step), or build a profile and match it.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi icon={<Briefcase size={16} />} label="Open positions" value={positions.length} />
            <Kpi icon={<Users size={16} />} label="Active candidates" value={activeCount} />
            <Kpi icon={<Clock size={16} />} label="In interview" value={interviewCount} />
            <Kpi
              icon={<TimerReset size={16} />}
              label={`Aging >${STALE_DAYS}d`}
              value={staleCount}
              tone={staleCount > 0 ? "amber" : "neutral"}
            />
            <Kpi
              icon={<Check size={16} />}
              label="Awaiting you"
              value={approvals.length}
              tone={approvals.length > 0 ? "coral" : "neutral"}
              onClick={() => router.push(buildUrl({ tab: "decisions" }))}
            />
          </div>

          {approvals.length > 0 ? (
            <button
              type="button"
              onClick={() => router.push(buildUrl({ tab: "decisions" }))}
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

          {events.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-meta uppercase tracking-wide text-steel">Activity</h3>
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

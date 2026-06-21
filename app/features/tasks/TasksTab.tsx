"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Clock, Loader2, RefreshCw, X } from "lucide-react";
import { useTasks, type Task, type TaskStatus } from "./TasksProvider";
import { SystemCard } from "./SystemCard";
import { BackupCard } from "./BackupCard";
import { IntegrationsCard } from "./IntegrationsCard";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useInfiniteScroll, type InfinitePage } from "@/app/_lib/useInfiniteScroll";
import { formatRelativeTime } from "@/app/_lib/format";

// Default window the live view shows; older runs page in via the history table.
// Mirrors RECENT_TASK_WINDOW_DAYS in app/_lib/tasks.ts (server-only, so the value
// is restated here rather than imported into this client bundle).
const RECENT_WINDOW_DAYS = 7;
const HISTORY_PAGE_SIZE = 20;

type StatusMeta = {
  label: string;
  badge: string;
  Icon: typeof Check;
  iconCls: string;
};

const STATUS: Record<TaskStatus, StatusMeta> = {
  running: { label: "Running", badge: "bg-coral/10 text-coral", Icon: Loader2, iconCls: "animate-spin text-coral" },
  queued: { label: "Queued", badge: "bg-steel/10 text-steel", Icon: Clock, iconCls: "text-steel" },
  succeeded: { label: "Done", badge: "bg-moss/10 text-moss", Icon: Check, iconCls: "text-moss" },
  failed: { label: "Failed", badge: "bg-coral/10 text-coral", Icon: AlertTriangle, iconCls: "text-coral" },
  canceled: { label: "Canceled", badge: "bg-stone-100 text-steel", Icon: Ban, iconCls: "text-steel" },
  interrupted: { label: "Interrupted", badge: "bg-amber-100 text-amber-700", Icon: AlertTriangle, iconCls: "text-amber-600" },
};

const ACTIVE = (t: Task) => t.status === "running" || t.status === "queued";

function pct(t: Task): number {
  if (t.progressTotal <= 0) return t.status === "running" ? 8 : 0;
  return Math.round((t.progressDone / t.progressTotal) * 100);
}

// Tasks show "—" for a never-run/invalid timestamp; otherwise the shared
// relative-time renderer (formatRelativeTime, which returns "" on invalid).
function relTime(iso: string | null): string {
  return (iso && formatRelativeTime(iso)) || "—";
}

// Wall-clock a task took (or has been running). Falls back gracefully when a
// boundary timestamp is missing rather than rendering "NaN".
function duration(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = Date.parse(start);
  const e = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  const secs = Math.round((e - s) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

// DATA6 — the status values the filter chips offer (terminal states only; the
// In-progress group is narrowed by kind/text but not by these).
const FILTER_STATUSES: TaskStatus[] = ["failed", "interrupted", "succeeded", "canceled"];

export function TasksTab() {
  const { tasks, cancelTask, refresh, startError, clearStartError } = useTasks();
  const [showHistory, setShowHistory] = useState(false);
  // DATA6 — client-side filter bar over the loaded window (the established
  // PIPE2/RES3 pattern); kind/status also thread into the history endpoint.
  const [textFilter, setTextFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null);
  const text = textFilter.trim().toLowerCase();
  const matchesFilters = (t: Task) =>
    (!kindFilter || t.kind === kindFilter) && (!text || (t.label ?? t.kind).toLowerCase().includes(text));
  const active = tasks.filter(ACTIVE).filter(matchesFilters);
  const done = tasks
    .filter((t) => !ACTIVE(t))
    .filter(matchesFilters)
    .filter((t) => !statusFilter || t.status === statusFilter);
  const kinds = [...new Set(tasks.map((t) => t.kind))].sort();
  const filtering = Boolean(text) || Boolean(kindFilter) || statusFilter !== null;

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-stone-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">Activity</p>
          <h2 className="mt-1 font-serif text-display text-ink">Background tasks</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">
            Long-running actions — analysis, screening, JD builds, group evaluations — run here in the background. Watch
            them progress and review what finished, even after switching tabs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-paper"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </header>

      {startError ? (
        <div className="flex items-start gap-2 rounded-lg border border-coral/40 bg-coral/5 p-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-coral" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-coral">Couldn&apos;t start the task</p>
            <p className="break-words text-sm text-steel">{startError.message}</p>
          </div>
          <button
            type="button"
            onClick={clearStartError}
            title="Dismiss"
            className="focus-ring shrink-0 rounded p-1 text-steel hover:bg-stone-100 hover:text-coral"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* DATA6: narrow the (often dozen-kind) window — free text over labels,
          a kind select, and terminal-status chips for the Done group. */}
      {tasks.length > 0 || showHistory ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="tasks-search" className="sr-only">
            Search tasks
          </label>
          <input
            id="tasks-search"
            type="search"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
            placeholder="Search tasks…"
            className="focus-ring h-9 min-w-[180px] flex-1 rounded-md border border-stone-200 px-3 text-base"
          />
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            aria-label="Filter by task kind"
            className="focus-ring h-9 rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
          >
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {FILTER_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter((cur) => (cur === s ? null : s))}
              aria-pressed={statusFilter === s}
              className={`focus-ring rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                statusFilter === s ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
              }`}
            >
              {STATUS[s].label}
            </button>
          ))}
          {filtering ? (
            <button
              type="button"
              onClick={() => {
                setTextFilter("");
                setKindFilter("");
                setStatusFilter(null);
              }}
              className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      {active.length === 0 && done.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-paper p-8 text-center">
          <Clock size={20} className="mx-auto text-steel" />
          <p className="mt-2 text-base font-medium text-ink">
            {filtering ? "No tasks match these filters" : "No recent background tasks"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-steel">
            {filtering
              ? "Clear the filters above to see the full window."
              : `Active and recently finished runs (last ${RECENT_WINDOW_DAYS} days) appear here. Older runs are available under “Show history” below.`}
          </p>
        </div>
      ) : (
        <>
          <Group title="In progress" count={active.length}>
            {active.length === 0 ? (
              <p className="text-base text-steel">Nothing running right now.</p>
            ) : (
              <ul className="space-y-3">
                {active.map((t) => (
                  <ActiveCard key={t.id} task={t} onCancel={() => void cancelTask(t.id)} />
                ))}
              </ul>
            )}
          </Group>

          {done.length > 0 ? (
            <Group title={`Done · last ${RECENT_WINDOW_DAYS} days`} count={done.length}>
              <ul className="divide-y divide-stone-100">
                {done.map((t) => (
                  <DoneRow key={t.id} task={t} />
                ))}
              </ul>
            </Group>
          ) : null}
        </>
      )}

      {/* Older runs are loaded only on demand — checking this reveals a history
          table that pages in 20 at a time, so the trail is never loaded at once. */}
      <label className="flex w-fit cursor-pointer items-center gap-2 text-base text-steel">
        <input
          type="checkbox"
          checked={showHistory}
          onChange={(e) => setShowHistory(e.target.checked)}
          className="focus-ring h-4 w-4 rounded border-stone-300 text-coral"
        />
        Show history (tasks older than {RECENT_WINDOW_DAYS} days)
      </label>

      {/* The keyed remount restarts the (accumulating) infinite scroll whenever
          a server-side filter changes — the engine pages from offset 0 again. */}
      {showHistory ? (
        <TaskHistory key={`${kindFilter}|${statusFilter ?? ""}`} kind={kindFilter} status={statusFilter} text={text} />
      ) : null}

      {/* DATA2 + DATA3 + P1-5: the operator panels — the tasks tab is their home. */}
      <SystemCard />
      <BackupCard />
      <IntegrationsCard />
    </section>
  );
}

// On-demand history of finished tasks older than the recent window. Reuses the
// shared infinite-scroll engine (same one behind the analytics audit log) to
// page in 20 at a time, with each freshly loaded page cascading in unless the
// user prefers reduced motion. kind/status narrow server-side (DATA6); the
// free-text filter applies client-side over the loaded pages, same as the
// live window.
function TaskHistory({ kind, status, text }: { kind: string; status: TaskStatus | null; text: string }) {
  const reduced = useReducedMotion();
  const buildUrl = useCallback(
    (offset: number, limit: number) => {
      const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      if (kind) params.set("kind", kind);
      if (status) params.set("status", status);
      return `/api/tasks/history?${params.toString()}`;
    },
    [kind, status]
  );
  const selectPage = useCallback((body: unknown): InfinitePage<Task> => {
    const b = body as { tasks: Task[]; total: number; hasMore: boolean; nextOffset: number };
    return { items: b.tasks, total: b.total, hasMore: b.hasMore, nextOffset: b.nextOffset };
  }, []);
  const { items, total, hasMore, phase, showInitialSkeleton, error, sentinelRef, loadMore } = useInfiniteScroll<Task>({
    pageSize: HISTORY_PAGE_SIZE,
    buildUrl,
    selectPage,
    errorLabel: "Couldn't load task history.",
  });

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-h2 text-ink">History</h3>
        <span className="text-meta uppercase text-steel">
          {total != null && items.length > 0 ? `${items.length} of ${total} · ` : ""}older than {RECENT_WINDOW_DAYS} days
        </span>
      </div>

      {showInitialSkeleton ? (
        <ul className="mt-3 divide-y divide-stone-100" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <HistorySkeletonRow key={i} />
          ))}
        </ul>
      ) : phase === "idle" && items.length === 0 ? (
        <p className="mt-3 text-base text-steel">No tasks older than {RECENT_WINDOW_DAYS} days.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100" aria-busy={phase === "more"}>
          {items
            .filter((t) => !text || (t.label ?? t.kind).toLowerCase().includes(text))
            .map((t, i) => (
              <DoneRow key={t.id} task={t} animateDelayMs={reduced ? null : (i % HISTORY_PAGE_SIZE) * 18} />
            ))}
          {phase === "more" ? Array.from({ length: 3 }).map((_, i) => <HistorySkeletonRow key={`s${i}`} />) : null}
        </ul>
      )}

      {phase === "error" ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2">
          <p className="text-base text-coral">{error ?? "Couldn't load task history."}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="focus-ring shrink-0 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Sentinel + manual fallback — the observer drives auto-loading; the button
          covers keyboard users and environments without IntersectionObserver. */}
      {hasMore && phase !== "error" ? (
        <div ref={sentinelRef} className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={phase === "more"}
            className="focus-ring rounded-md border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-paper disabled:opacity-60"
          >
            {phase === "more" ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : !hasMore && items.length > 0 && phase === "idle" ? (
        <p className="mt-3 text-center text-sm text-steel">End of history · {items.length} tasks</p>
      ) : null}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-h2 text-ink">{title}</h3>
        <span className="text-meta uppercase text-steel">{count}</span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ActiveCard({ task, onCancel }: { task: Task; onCancel: () => void }) {
  const meta = STATUS[task.status];
  // Cancel is destructive (kills a running job) and was a single unguarded click with
  // no feedback. Require an inline confirm, then show a pending state until the card
  // drops off on the next refresh.
  const [confirming, setConfirming] = useState(false);
  const [canceling, setCanceling] = useState(false);
  return (
    <li className="rounded-md border border-stone-200 bg-paper/50 p-3">
      <div className="flex items-center gap-2">
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold ${meta.badge}`}>
          <meta.Icon size={11} className={meta.iconCls} />
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">{task.label ?? task.kind}</span>
        {canceling ? (
          <span className="shrink-0 text-meta text-steel">Canceling…</span>
        ) : confirming ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setCanceling(true);
                onCancel();
              }}
              className="focus-ring rounded border border-coral/40 px-1.5 py-0.5 text-meta font-semibold text-coral hover:bg-coral/5"
            >
              Cancel task
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="focus-ring rounded border border-stone-200 px-1.5 py-0.5 text-meta font-semibold text-steel hover:bg-stone-100"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            title="Cancel task"
            aria-label="Cancel task"
            className="focus-ring shrink-0 rounded p-1 text-steel hover:bg-stone-100 hover:text-coral"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
        <div className="h-full rounded-full bg-coral transition-all duration-500" style={{ width: `${Math.max(6, pct(task))}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-sm text-steel">
        <span className="min-w-0 truncate">
          {task.progressTotal > 0 ? `${task.progressDone}/${task.progressTotal} · ` : ""}
          {task.progressMsg ?? (task.status === "queued" ? "queued…" : "working…")}
        </span>
        <span className="shrink-0 font-mono text-sm text-steel/80">{task.kind}</span>
      </div>
    </li>
  );
}

// `animateDelayMs` cascades a freshly loaded history page in; live (last-7-days)
// rows omit it so polling never re-triggers motion. CSS animations only fire on
// mount, so already-present rows never re-animate regardless.
function DoneRow({ task, animateDelayMs = null }: { task: Task; animateDelayMs?: number | null }) {
  const { retryTask, fetchTask } = useTasks();
  const [retrying, setRetrying] = useState(false);
  // DATA5 — the outcome drawer: the row expands to the task's full record
  // (fetchTask — the polled list deliberately omits result/params blobs).
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<Task | null>(null);
  const [outcomeFailed, setOutcomeFailed] = useState(false);
  const meta = STATUS[task.status];
  const dur = duration(task.startedAt, task.finishedAt);
  const failed = task.status === "failed" || task.status === "interrupted";
  // DATA1 — every dead-end terminal row can replay from its persisted params;
  // the new run appears in "In progress" via the existing poll (the old row
  // stays as the audit record of the failure).
  const retryable = task.status === "failed" || task.status === "interrupted" || task.status === "canceled";
  const animate = animateDelayMs != null;
  const toggleOutcome = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !full) {
      void fetchTask(task.id).then((t) => {
        if (t) setFull(t);
        else setOutcomeFailed(true);
      });
    }
  };
  return (
    <li
      className={`py-2.5 ${animate ? "animate-fade-in" : ""}`}
      style={animate ? { animationDelay: `${animateDelayMs}ms` } : undefined}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold ${meta.badge}`}>
          <meta.Icon size={11} className={meta.iconCls} />
          {meta.label}
        </span>
        <button
          type="button"
          onClick={toggleOutcome}
          aria-expanded={expanded}
          title="Show this task's outcome"
          className="focus-ring min-w-0 flex-1 text-left"
        >
          <p className="flex items-center gap-1 text-base text-ink">
            {expanded ? (
              <ChevronDown size={13} className="shrink-0 text-steel" aria-hidden />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-steel" aria-hidden />
            )}
            <span className="min-w-0 truncate">{task.label ?? task.kind}</span>
          </p>
          {failed && task.error ? <p className="mt-0.5 break-words text-sm text-coral">{task.error}</p> : null}
          <p className="mt-0.5 font-mono text-sm text-steel/70">{task.kind}</p>
        </button>
        {retryable ? (
          <button
            type="button"
            onClick={() => {
              setRetrying(true);
              void retryTask(task.id).finally(() => setRetrying(false));
            }}
            disabled={retrying}
            title="Run this task again with the same inputs"
            className="focus-ring mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-medium text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-60"
          >
            <RefreshCw size={12} className={retrying ? "animate-spin" : ""} /> Retry
          </button>
        ) : null}
        <div className="shrink-0 text-right text-sm text-steel">
          <p>{relTime(task.finishedAt ?? task.startedAt ?? task.createdAt)}</p>
          {dur ? <p className="text-sm text-steel/70">took {dur}</p> : null}
        </div>
      </div>
      {expanded ? (
        <div className="ml-8 mt-2">
          {full ? (
            <TaskOutcome task={full} />
          ) : outcomeFailed ? (
            <p className="text-sm text-coral">Couldn&apos;t load this task&apos;s outcome.</p>
          ) : (
            <p className="text-sm text-steel">Loading outcome…</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

// DATA5 — compact outcome summary for a finished task. batch_screen gets its
// rich counts; everything else falls back to the result's scalar fields (the
// generic shape readable without per-kind plumbing). The deep link is derived
// from params/result so a task row connects back to the entity it concerned.
function outcomeLink(task: Task): { href: string; label: string } | null {
  const params = (task.params as Record<string, unknown>) ?? {};
  const result = (task.result as Record<string, unknown>) ?? {};
  if (task.kind === "analyze") {
    const persistence = result["persistence"] as { slug?: unknown } | undefined;
    if (persistence && typeof persistence.slug === "string" && persistence.slug) {
      return { href: `/history/${encodeURIComponent(persistence.slug)}`, label: "Open saved report" };
    }
    return null;
  }
  // The task id rides along (?jdTask=) so JdBuilder can rehydrate this build's
  // generated JD — a bare /?tab=library landed on an empty builder, because the
  // tab switch had unmounted the component that held the result.
  if (task.kind === "jd_build") {
    return { href: `/?tab=library&jdTask=${encodeURIComponent(task.id)}`, label: "Open the JD library" };
  }
  // Decision-shaped runs land their output in the Decisions queue: a group eval
  // saves per-role (the ?job= filter isolates it), a batch screen raises
  // holds/reviews there.
  if (task.kind === "group_eval") {
    const jobId = params["jobId"] ?? params["roleKey"];
    return typeof jobId === "string" && jobId
      ? { href: `/?tab=decisions&job=${encodeURIComponent(jobId)}`, label: "Open the role's decisions" }
      : { href: "/?tab=decisions", label: "Open Decisions" };
  }
  if (task.kind === "batch_screen") return { href: "/?tab=decisions", label: "Review outcomes in Decisions" };
  // Prep artifacts are opened from the Schedule tab's candidate cards.
  if (task.kind === "interview_prep") return { href: "/?tab=schedule", label: "Open Schedule" };
  // Entry-scoped kinds carry a label; ANA1's board ?q= filter isolates the
  // candidate (no per-entry deep link exists).
  const entryLabel = params["entryLabel"] ?? params["candidateLabel"];
  if (typeof entryLabel === "string" && entryLabel) {
    return { href: `/?tab=pipeline&q=${encodeURIComponent(entryLabel)}`, label: "Open on the board" };
  }
  return null;
}

function TaskOutcome({ task }: { task: Task }) {
  const link = outcomeLink(task);
  const result = task.result && typeof task.result === "object" ? (task.result as Record<string, unknown>) : null;
  // Scalars only: nested blobs (full analysis payloads, drafts) belong on their
  // own surfaces — the deep link is the path to them.
  const scalars = result
    ? Object.entries(result).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)).slice(0, 8)
    : [];
  return (
    <div className="space-y-1.5 rounded-md border border-stone-200 bg-paper/60 px-3 py-2">
      {task.kind === "batch_screen" && result ? (
        <p className="text-sm text-ink">
          <span className="font-semibold text-moss">{Number(result["advanced"] ?? 0)} advanced</span>
          {" · "}
          <span className="font-semibold text-ink">{Number(result["held"] ?? 0)} held</span>
          {" · "}
          <span className="text-steel">{Number(result["advisory"] ?? 0)} advisory</span>
          {Number(result["errors"] ?? 0) > 0 ? (
            <span className="font-semibold text-coral"> · {Number(result["errors"])} errors</span>
          ) : null}
          <span className="text-steel"> · of {Number(result["total"] ?? 0)}</span>
        </p>
      ) : scalars.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          {scalars.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-steel/80">{k}</dt>
              <dd className="min-w-0 truncate text-ink">{String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-steel">{task.status === "succeeded" ? "No summary recorded for this run." : "This run produced no result."}</p>
      )}
      {link ? (
        <Link href={link.href} className="focus-ring inline-block rounded text-sm font-semibold text-coral underline-offset-2 hover:underline">
          {link.label} →
        </Link>
      ) : null}
    </div>
  );
}

function HistorySkeletonRow() {
  return (
    <li className="flex items-start gap-3 py-2.5" aria-hidden>
      <span className="mt-0.5 h-5 w-16 shrink-0 animate-pulse rounded-full bg-stone-100" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <span className="block h-3.5 w-2/3 animate-pulse rounded bg-stone-100" />
        <span className="block h-3 w-1/4 animate-pulse rounded bg-stone-100" />
      </div>
      <span className="h-3 w-12 shrink-0 animate-pulse rounded bg-stone-100" />
    </li>
  );
}

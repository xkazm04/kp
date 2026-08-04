"use client";

// A finished task's row (+ its expandable outcome drawer), split out of
// TasksTab.tsx so it stays under the 200-line file cap. Verbatim — same
// DATA5 outcome derivation/rendering, same DATA1 retry affordance.
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { renderTaskLabel } from "@/app/_lib/task-label";
import { useTasks, type Task } from "./TasksProvider";
import { STATUS, duration, relTime } from "./tasksTabHelpers";

// The deep-link targets a finished task offers. `key` names the copy in
// `tasks.outcome.*` rather than carrying a sentence — this is a pure router-ish
// derivation and holds no strings a user reads.
type OutcomeKey =
  | "openSavedReport"
  | "openJdLibrary"
  | "openRoleDecisions"
  | "openDecisions"
  | "reviewInDecisions"
  | "openSchedule"
  | "openBoard";

// DATA5 — compact outcome summary for a finished task. batch_screen gets its
// rich counts; everything else falls back to the result's scalar fields (the
// generic shape readable without per-kind plumbing). The deep link is derived
// from params/result so a task row connects back to the entity it concerned.
function outcomeLink(task: Task): { href: string; key: OutcomeKey } | null {
  const params = (task.params as Record<string, unknown>) ?? {};
  const result = (task.result as Record<string, unknown>) ?? {};
  if (task.kind === "analyze") {
    const persistence = result["persistence"] as { slug?: unknown } | undefined;
    if (persistence && typeof persistence.slug === "string" && persistence.slug) {
      return { href: `/history/${encodeURIComponent(persistence.slug)}`, key: "openSavedReport" };
    }
    return null;
  }
  // The task id rides along (?jdTask=) so JdBuilder can rehydrate this build's
  // generated JD — a bare /?tab=library landed on an empty builder, because the
  // tab switch had unmounted the component that held the result.
  if (task.kind === "jd_build") {
    return { href: `/?tab=library&jdTask=${encodeURIComponent(task.id)}`, key: "openJdLibrary" };
  }
  // Decision-shaped runs land their output in the Decisions queue: a group eval
  // saves per-role (the ?job= filter isolates it), a batch screen raises
  // holds/reviews there.
  if (task.kind === "group_eval") {
    const jobId = params["jobId"] ?? params["roleKey"];
    return typeof jobId === "string" && jobId
      ? { href: `/?tab=decisions&job=${encodeURIComponent(jobId)}`, key: "openRoleDecisions" }
      : { href: "/?tab=decisions", key: "openDecisions" };
  }
  if (task.kind === "batch_screen") return { href: "/?tab=decisions", key: "reviewInDecisions" };
  // Prep artifacts are opened from the Schedule tab's candidate cards.
  if (task.kind === "interview_prep") return { href: "/?tab=schedule", key: "openSchedule" };
  // Entry-scoped kinds carry a label; ANA1's board ?q= filter isolates the
  // candidate (no per-entry deep link exists).
  const entryLabel = params["entryLabel"] ?? params["candidateLabel"];
  if (typeof entryLabel === "string" && entryLabel) {
    return { href: `/?tab=pipeline&q=${encodeURIComponent(entryLabel)}`, key: "openBoard" };
  }
  return null;
}

function TaskOutcome({ task }: { task: Task }) {
  const t = useTranslations("tasks");
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
          <span className="font-semibold text-moss">{t("outcome.advanced", { count: Number(result["advanced"] ?? 0) })}</span>
          {" · "}
          <span className="font-semibold text-ink">{t("outcome.held", { count: Number(result["held"] ?? 0) })}</span>
          {" · "}
          <span className="text-steel">{t("outcome.advisory", { count: Number(result["advisory"] ?? 0) })}</span>
          {Number(result["errors"] ?? 0) > 0 ? (
            <span className="font-semibold text-coral"> · {t("outcome.errors", { count: Number(result["errors"]) })}</span>
          ) : null}
          <span className="text-steel"> · {t("outcome.ofTotal", { count: Number(result["total"] ?? 0) })}</span>
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
        <p className="text-sm text-steel">{task.status === "succeeded" ? t("outcome.noSummary") : t("outcome.noResult")}</p>
      )}
      {link ? (
        <Link href={link.href} className="focus-ring inline-block rounded text-sm font-semibold text-coral underline-offset-2 hover:underline">
          {t(`outcome.${link.key}`)} →
        </Link>
      ) : null}
    </div>
  );
}

// `animateDelayMs` cascades a freshly loaded history page in; live (last-7-days)
// rows omit it so polling never re-triggers motion. CSS animations only fire on
// mount, so already-present rows never re-animate regardless.
export function DoneRow({ task, animateDelayMs = null }: { task: Task; animateDelayMs?: number | null }) {
  const locale = useLocale();
  const t = useTranslations("tasks");
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
          {t(`status.${task.status}`)}
        </span>
        <button
          type="button"
          onClick={toggleOutcome}
          aria-expanded={expanded}
          title={t("done.outcomeTitle")}
          className="focus-ring min-w-0 flex-1 text-left"
        >
          <p className="flex items-center gap-1 text-base text-ink">
            {expanded ? (
              <ChevronDown size={13} className="shrink-0 text-steel" aria-hidden />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-steel" aria-hidden />
            )}
            <span className="min-w-0 truncate">{renderTaskLabel(t, task)}</span>
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
            title={t("done.retryTitle")}
            className="focus-ring mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-medium text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-60"
          >
            <RefreshCw size={12} className={retrying ? "animate-spin" : ""} /> {t("done.retry")}
          </button>
        ) : null}
        <div className="shrink-0 text-right text-sm text-steel">
          <p>{relTime(task.finishedAt ?? task.startedAt ?? task.createdAt, locale)}</p>
          {dur ? <p className="text-sm text-steel/70">{t("done.took", { duration: dur })}</p> : null}
        </div>
      </div>
      {expanded ? (
        <div className="ml-8 mt-2">
          {full ? (
            <TaskOutcome task={full} />
          ) : outcomeFailed ? (
            <p className="text-sm text-coral">{t("done.outcomeFailed")}</p>
          ) : (
            <p className="text-sm text-steel">{t("done.outcomeLoading")}</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

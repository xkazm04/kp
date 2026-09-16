"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, History } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_SECONDARY, EYEBROW, FIELD, INTRO, META_LABEL, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { SCAN_JOB_NAME, type JobseekerSource, type ScanSummary, type SourceRunSummary } from "@/app/_lib/jobseeker/types";
import type { SchedulerJobView } from "@/app/features/hiring/pipeline/SchedulerSummaryBadges";
import { nearestScanInterval, SCAN_INTERVALS } from "./feedModel";
import { ScanNowButton } from "./ScanNowButton";
import { callJson, entryForSource, type ApiFailure, type SourcesPayload } from "./sourcesApi";
import { useScanTask } from "./useScanTask";

// /me/scans — the clock job as the seeker sees it. ONE row of the shared registry
// (GET /api/automation/schedule `jobs[]`, filtered to `jobseeker_scan`): on/off (the
// toggle is disabled with `pipeline.scheduler.unverified` as its title until one manual
// scan succeeded, and the route refuses the same write with JOBSEEKER_SCAN_UNVERIFIED),
// the cadence as three honest choices (6 h / 12 h / 24 h), the "Scan now" door with its
// live progress, and the run history unrolled per source: outcome word + counts, with
// `blocked` / `collapsed` in amber beside the pause reason and a link to /me/sources,
// because only the owner clears those.
//
// SchedulerJobRow (the recruiter panel's generic row) is not reused: its cadence
// control is a free minutes field and its history is the policy pass's decision list;
// this surface wants a three-option select and a per-source table.

const OUTCOME_TONE: Record<SourceRunSummary["outcome"], "positive" | "caution" | "critical" | "neutral"> = {
  succeeded: "positive",
  collapsed: "caution",
  blocked: "caution",
  offline: "neutral",
  failed: "critical",
  skipped: "neutral",
};

function isScanSummary(v: unknown): v is ScanSummary {
  return !!v && typeof v === "object" && Array.isArray((v as { sources?: unknown }).sources);
}

export function ScansPage() {
  const t = useTranslations("me.scans");
  const tSched = useTranslations("pipeline.scheduler");
  const tSources = useTranslations("me.sources");
  const rel = useRelativeTime();
  const resolveError = useErrorMessage();
  const [job, setJob] = useState<SchedulerJobView | null>(null);
  const [sources, setSources] = useState<JobseekerSource[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [writeError, setWriteError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);

  // Every setState sits in the promise callback (the mount effect calls this; see
  // react-hooks/set-state-in-effect): the skeleton is `job === null`.
  const load = useCallback(
    () =>
      Promise.all([callJson<{ jobs?: SchedulerJobView[] }>("/api/automation/schedule"), callJson<SourcesPayload>("/api/jobseeker/sources")]).then(([sched, src]) => {
        if (!sched.ok) {
          setLoadError(sched.fail);
          return;
        }
        setLoadError(null);
        setJob(sched.body.jobs?.find((j) => j.name === SCAN_JOB_NAME) ?? null);
        if (src.ok) {
          setSources(src.body.sources);
          setLabels(new Map(src.body.sources.map((s) => [s.id, entryForSource(src.body.catalog, s)?.label ?? s.host])));
        }
      }),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);

  const write = async (body: Record<string, unknown>) => {
    setBusy(true);
    setWriteError(null);
    const r = await callJson<{ jobs?: SchedulerJobView[] }>("/api/automation/schedule", { method: "POST", body: JSON.stringify({ job: SCAN_JOB_NAME, ...body }) });
    setBusy(false);
    if (!r.ok) {
      setWriteError(r.fail);
      return;
    }
    setJob(r.body.jobs?.find((j) => j.name === SCAN_JOB_NAME) ?? null);
  };

  const scan = useScanTask(() => void load());
  const pausedById = useMemo(() => new Map(sources.filter((s) => s.pausedReason).map((s) => [s.id, s.pausedReason!])), [sources]);
  const locked = !!job && job.requiresVerifiedRun && !job.verified;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
          <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
        </div>
        <ScanNowButton scan={scan} />
      </header>

      {loadError ? (
        <div className={`${PANEL} p-4`} role="alert">
          <p className="text-sm text-red-700">{resolveError(loadError, t("loadError"))}</p>
          <button type="button" className={`${BTN_SECONDARY} mt-2 h-8 px-3 text-sm`} onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!job && !loadError ? (
        <div className={`${PANEL} p-4`} aria-busy="true" aria-label={t("loading")}>
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ) : null}

      {job ? (
        <section className={`${PANEL} p-4`} aria-labelledby="scan-clock">
          <h2 id="scan-clock" className={META_LABEL}>
            {t("clock.title")}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={job.schedule.enabled}
              disabled={busy || locked}
              title={locked ? tSched("unverified") : t("clock.toggleTitle")}
              onClick={() => void write({ enabled: !job.schedule.enabled })}
              className={`focus-ring inline-flex h-8 items-center rounded-full px-3 text-sm font-semibold disabled:opacity-60 ${job.schedule.enabled ? "bg-moss/15 text-moss" : "bg-stone-200 text-steel"}`}
              data-testid="scan-clock-toggle"
            >
              {job.schedule.enabled ? t("clock.on") : t("clock.off")}
            </button>
            <label className="flex items-center gap-1.5 text-sm text-steel">
              {t("clock.every")}
              <select className={`${FIELD} h-8 w-20 py-0`} value={nearestScanInterval(job.schedule.intervalMinutes)} disabled={busy} onChange={(e) => void write({ intervalMinutes: Number(e.target.value) })} aria-label={t("clock.intervalAria")}>
                {SCAN_INTERVALS.map((m) => (
                  <option key={m} value={m}>
                    {t("clock.hours", { hours: m / 60 })}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm text-steel">{job.schedule.lastRunAt ? t("clock.lastRun", { when: rel(job.schedule.lastRunAt) }) : t("clock.never")}</span>
          </div>
          {locked ? <p className="mt-2 text-sm text-steel">{tSched("unverified")}</p> : null}
          {writeError ? (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {resolveError(writeError, t("updateError"))}
            </p>
          ) : null}
        </section>
      ) : null}

      {job ? (
        <section className="space-y-3" aria-labelledby="scan-history">
          <h2 id="scan-history" className="flex items-center gap-1.5 font-serif text-h3 text-ink">
            <History size={16} aria-hidden /> {t("history.title")}
          </h2>
          {job.runs.length === 0 ? (
            <p className="text-sm text-steel">{t("history.none")}</p>
          ) : (
            <ol className="space-y-3">
              {job.runs.map((run) => {
                const summary = isScanSummary(run.summary) ? run.summary : null;
                return (
                  <li key={run.id} className={`${PANEL} p-4`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-ink">{rel(run.startedAt)}</span>
                      <Badge tone={run.status === "error" ? "critical" : run.status === "skipped" ? "neutral" : "positive"} label={t(`history.status.${run.status === "error" ? "error" : run.status === "skipped" ? "skipped" : "ok"}`)} />
                      <span className="text-steel">{t(`history.trigger.${run.trigger === "clock" ? "clock" : "manual"}`)}</span>
                      {summary ? (
                        <span className="text-steel">
                          {t("history.matched", { n: summary.matched })}
                          {" · "}
                          {summary.deepDiveSkipped === "no_provider" ? t("history.deepDiveSkipped") : t("history.deepDived", { n: summary.deepDived })}
                        </span>
                      ) : null}
                      {run.status === "error" ? <span className="text-red-700">{run.error ? tSched("runFailedMsg", { msg: run.error }) : tSched("runFailed")}</span> : null}
                    </div>
                    {summary && summary.sources.length > 0 ? (
                      <table className="mt-3 w-full text-sm">
                        <thead>
                          <tr className="text-left text-sm text-steel">
                            <th className="py-1 pr-3 font-medium">{t("table.source")}</th>
                            <th className="py-1 pr-3 font-medium">{t("table.outcome")}</th>
                            <th className="py-1 pr-3 font-medium nums">{t("table.new")}</th>
                            <th className="py-1 pr-3 font-medium nums">{t("table.changed")}</th>
                            <th className="py-1 pr-3 font-medium nums">{t("table.absent")}</th>
                            <th className="py-1 font-medium">{t("table.reason")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.sources.map((s) => {
                            const attention = s.outcome === "blocked" || s.outcome === "collapsed";
                            const paused = pausedById.get(s.sourceId);
                            return (
                              <tr key={s.sourceId} className="border-t border-stone-200 align-top">
                                <td className="py-1 pr-3 text-ink">{labels.get(s.sourceId) ?? s.sourceId}</td>
                                <td className="py-1 pr-3">
                                  <Badge tone={OUTCOME_TONE[s.outcome]} label={tSources(`outcome.${s.outcome}`)} />
                                </td>
                                <td className="py-1 pr-3 nums text-ink">{s.new}</td>
                                <td className="py-1 pr-3 nums text-ink">{s.changed}</td>
                                <td className="py-1 pr-3 nums text-ink">{s.absent}</td>
                                <td className={`py-1 ${attention ? "text-amber-700" : "text-steel"}`}>
                                  {attention ? (
                                    <span className="inline-flex flex-wrap items-center gap-1">
                                      <AlertTriangle size={12} aria-hidden />
                                      {s.reason ?? ""}
                                      {paused ? ` · ${tSources("pausedShort", { reason: tSources(`pauseReason.${paused}`) })}` : ""}
                                      <Link href="/me/sources" className="focus-ring rounded underline">
                                        {t("table.resumeLink")}
                                      </Link>
                                    </span>
                                  ) : (
                                    (s.reason ?? "")
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}

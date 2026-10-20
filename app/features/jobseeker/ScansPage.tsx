"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { EYEBROW, FIELD, INTRO, NOTICE, PAGE_HEADER, PANEL, SECTION, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { ArrivalList } from "@/app/features/library/jds/intake/IntakeArrivalMotion";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { SCAN_JOB_NAME, scanWholePhaseFailure, type JobseekerSource, type ScanPhaseFailure, type ScanSummary } from "@/app/_lib/jobseeker/types";
import type { SchedulerJobView } from "@/app/features/hiring/pipeline/SchedulerSummaryBadges";
import { FailureNotice } from "./FailureNotice";
import { nearestScanInterval, SCAN_INTERVALS } from "./feedModel";
import { ScanNowButton } from "./ScanNowButton";
import { ScanRunTable } from "./ScanRunTable";
import { useIdArrival } from "./sourceArrival";
import { SourceSwitch } from "./SourceSwitch";
import { callJson, entryForSource, type ApiFailure, type SourcesPayload } from "./sourcesApi";
import { useScanTask } from "./useScanTask";

// /me/scans — the clock job as the seeker sees it. ONE row of the shared registry
// (GET /api/automation/schedule `jobs[]`, filtered to `jobseeker_scan`): on/off (the
// switch is disabled until one manual scan succeeded, and the route refuses the same
// write with JOBSEEKER_SCAN_UNVERIFIED), the cadence as three honest choices
// (6 h / 12 h / 24 h), the "Scan now" door with its live progress, and the run history
// unrolled per source: outcome word + counts, with `blocked` / `collapsed` beside the
// pause reason and a link to /me/sources, because only the owner clears those.
//
// SERVER-FIRST (loading-choreography.md). `initialJob` / `initialSources` are what
// app/me/scans/page.tsx read on the server, so the header, the clock frame and the
// history paint on the FIRST frame. This page used to mount empty and flash a grey
// panel skeleton whose shape did not mirror the clock it stood in for. The client still
// owns every write and re-reads both endpoints in the background; a refresh settles
// behind what is on screen rather than blanking it.
//
// SchedulerJobRow (the recruiter panel's generic row) is not reused: its cadence
// control is a free minutes field and its history is the policy pass's decision list;
// this surface wants a three-option select and a per-source table.

function isScanSummary(v: unknown): v is ScanSummary {
  return !!v && typeof v === "object" && Array.isArray((v as { sources?: unknown }).sources);
}

/** A stored count, or 0 for a summary written before the field existed. */
function countOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function ScansPage({
  initialJob,
  initialSources,
  initialLabels,
}: {
  /** The registry's `jobseeker_scan` row as the server read it. */
  initialJob: SchedulerJobView;
  initialSources: JobseekerSource[];
  /** [sourceId, catalog label] pairs — a Map is not serializable across the boundary. */
  initialLabels: [string, string][];
}) {
  const t = useTranslations("me.scans");
  const tSched = useTranslations("pipeline.scheduler");
  const rel = useRelativeTime();
  const resolveError = useErrorMessage();
  // One phase failure as a sentence: which phase, how much of it, and the code's own
  // localized message — never the engine's text (the summary does not carry it).
  const failureLine = (f: ScanPhaseFailure) =>
    t(`history.failure.${f.phase}`, { chunks: f.chunks, of: f.of, msg: resolveError({ code: f.code }, f.code) });
  const [job, setJob] = useState<SchedulerJobView>(initialJob);
  const [sources, setSources] = useState<JobseekerSource[]>(initialSources);
  const [labels, setLabels] = useState<Map<string, string>>(() => new Map(initialLabels));
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  // The source list is a SECOND read and it fails on its own: without it the history
  // table can only name a source by its opaque id, and the reader has to be told that
  // is what they are looking at rather than left to guess.
  const [sourcesError, setSourcesError] = useState<ApiFailure | null>(null);
  const [writeError, setWriteError] = useState<ApiFailure | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState(false);
  // Whether the history region has been replaced by a live read yet. Tier 2 of the
  // choreography: the server's rows are on screen from frame one, and the region wears
  // `animate-arrive-in` once only, when the background read swaps them.
  const [refreshed, setRefreshed] = useState(false);

  // Every setState sits in the promise callback (the mount effect calls this; see
  // react-hooks/set-state-in-effect).
  const load = useCallback(
    () =>
      Promise.all([callJson<{ jobs?: SchedulerJobView[] }>("/api/automation/schedule"), callJson<SourcesPayload>("/api/jobseeker/sources")]).then(([sched, src]) => {
        // The two reads are independent: one failing must not blank what the other
        // brought back, and the clock the page already holds stays on screen.
        if (sched.ok) {
          setLoadError(null);
          const next = sched.body.jobs?.find((j) => j.name === SCAN_JOB_NAME);
          if (next) setJob(next);
          setRefreshed(true);
        } else {
          setLoadError(sched.fail);
        }
        if (src.ok) {
          setSourcesError(null);
          setSources(src.body.sources);
          setLabels(new Map(src.body.sources.map((s) => [s.id, entryForSource(src.body.catalog, s)?.label ?? s.host])));
        } else {
          setSourcesError(src.fail);
        }
      }),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);

  // Retry re-issues both reads; the clock, the history and the "Scan now" door that
  // are already on screen stay where they are while it runs.
  const retry = useCallback(() => {
    setRetrying(true);
    void load().finally(() => setRetrying(false));
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
    const next = r.body.jobs?.find((j) => j.name === SCAN_JOB_NAME);
    if (next) setJob(next);
  };

  const scan = useScanTask(() => void load());
  const pausedById = useMemo(() => new Map(sources.filter((s) => s.pausedReason).map((s) => [s.id, s.pausedReason!])), [sources]);
  const locked = job.requiresVerifiedRun && !job.verified;
  const runArrival = useIdArrival(job.runs.map((r) => String(r.id)));

  return (
    // Tier 1: the header, the clock and the history are the direct children that
    // cascade in. None of them waits on a fetch.
    <div className={`stagger-children ${SECTION}`}>
      <header className={PAGE_HEADER}>
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
          <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
        </div>
        <ScanNowButton scan={scan} />
      </header>

      <section className={`${PANEL} p-4`} aria-labelledby="scan-clock">
        <h2 id="scan-clock" className="font-serif text-h3 text-ink">
          {t("clock.title")}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {/* The house switch, shared with a source row. It was the SAME hand-rolled
              literal in two files, with no dark half; and its only explanation of why
              it is locked was a `title=`, which never reaches a keyboard or touch
              reader — the hint is now the switch's own tooltip, so the paragraph that
              repeated it below the row could go (surface-doctrine §1). */}
          <SourceSwitch
            on={job.schedule.enabled}
            label={t("clock.toggleTitle")}
            hint={locked ? tSched("unverified") : null}
            onLabel={t("clock.on")}
            offLabel={t("clock.off")}
            disabled={locked}
            busy={busy}
            onToggle={() => void write({ enabled: !job.schedule.enabled })}
            testId="scan-clock-toggle"
          />
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
        {writeError ? <FailureNotice failure={writeError} fallback={t("updateError")} className="mt-2" onDismiss={() => setWriteError(null)} /> : null}
        {/* A failed background refresh of the schedule: the clock above is still the
            last truth the server gave us, so this reports staleness, not emptiness. */}
        {loadError ? <FailureNotice failure={loadError} fallback={t("loadError")} onRetry={retry} retrying={retrying} className="mt-2" /> : null}
      </section>

      <section className="space-y-3" aria-labelledby="scan-history">
        <h2 id="scan-history" className="flex items-center gap-1.5 font-serif text-h3 text-ink">
          <History size={16} aria-hidden /> {t("history.title")}
        </h2>
        {/* The per-source table below names a source by its catalog label; when that
            read failed it can only print the stored id, and it says so. */}
        {sourcesError ? <FailureNotice failure={sourcesError} fallback={t("sourcesError")} onRetry={retry} retrying={retrying} /> : null}
        {/* Tier 2: the rows are here from the first frame (the server read them); the
            fade plays once, when the live read replaces them. */}
        <div className={refreshed ? "animate-arrive-in" : ""}>
          {job.runs.length === 0 ? (
            <p className="text-sm text-steel">{t("history.none")}</p>
          ) : (
            // The runs cascade once on first paint; after that only a run that just
            // landed animates, and the rest keep their elements (surface-doctrine §5).
            <ol className="space-y-3">
              <ArrivalList
                items={job.runs}
                keyOf={(run) => String(run.id)}
                idOf={(run) => String(run.id)}
                delta={runArrival}
                itemClassName={`${PANEL} p-4`}
                renderItem={(run) => {
                  const summary = isScanSummary(run.summary) ? run.summary : null;
                  const failures: ScanPhaseFailure[] = summary && Array.isArray(summary.failures) ? summary.failures : [];
                  // An `error` run of this job is a phase that failed WHOLE (tasks.ts):
                  // its sentence is the failure block's; any other failed phase is a
                  // caveat line under the counts.
                  const whole = run.status === "error" && summary ? scanWholePhaseFailure(summary) : null;
                  const partial = failures.filter((f) => f.phase !== whole?.phase);
                  const koFiltered = countOf(summary?.koFiltered);
                  const upToDate = countOf(summary?.skippedUpToDate);
                  return (
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-ink">{rel(run.startedAt)}</span>
                        <Badge tone={run.status === "error" ? "critical" : run.status === "skipped" ? "neutral" : "positive"} label={t(`history.status.${run.status === "error" ? "error" : run.status === "skipped" ? "skipped" : "ok"}`)} />
                        <span className="text-steel">{t(`history.trigger.${run.trigger === "clock" ? "clock" : "manual"}`)}</span>
                        {summary ? (
                          <span className="nums text-steel">
                            {t("history.matched", { n: summary.matched })}
                            {koFiltered > 0 ? ` · ${t("history.koFiltered", { n: koFiltered })}` : null}
                            {upToDate > 0 ? ` · ${t("history.upToDate", { n: upToDate })}` : null}
                            {" · "}
                            {summary.deepDiveSkipped === "no_provider" ? t("history.deepDiveSkipped") : t("history.deepDived", { n: summary.deepDived })}
                          </span>
                        ) : null}
                      </div>
                      {/* A failed run is the surface's one failure block, not a bare red
                          span: the sentence is localized and the detail rides inside it
                          (the persisted error has no machine code to resolve). */}
                      {run.status === "error" ? (
                        <FailureNotice
                          fallback={whole ? failureLine(whole) : run.error ? tSched("runFailedMsg", { msg: resolveError({ code: run.error }, run.error) }) : tSched("runFailed")}
                          className="mt-2"
                        />
                      ) : null}
                      {partial.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {partial.map((f) => (
                            <li key={f.phase} className={`${NOTICE("amber")} px-3 py-1.5 text-micro`}>
                              {failureLine(f)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {summary && summary.sources.length > 0 ? <ScanRunTable rows={summary.sources} labels={labels} pausedById={pausedById} /> : null}
                    </>
                  );
                }}
              />
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

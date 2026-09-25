"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Radar } from "lucide-react";
import { BTN_AFFIRM, BTN_PRIMARY, BTN_SECONDARY, CHIP, CHIP_QUIET, META_LABEL, NOTICE, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { GIG_INVALID_STREAK_LIMIT } from "@/app/_lib/gigs/types";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { sourceScanView, streakTone, type CatalogEntry, type SourceRow, type StreakTone } from "./gigsLogic";
import { Absent } from "./GigsFacts";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// The sources: official APIs only. Each configured source shows its tier, whether it is
// running or paused and why, its rejected streak (top right, its tone rising as it nears
// the auto-pause) and its last run (bottom left), and can be scanned on its own (bottom
// right: POST /api/gigs/scan {sourceId}, then the task followed through the workspace's
// task poll - useTaskResult - to its outcome and new-listing count). A tier-B source runs
// only after the operator acknowledges the terms summary the catalog shows - the summary
// and its hash are on screen, exactly what the acknowledgement records. A source that
// needs a key names the environment variables it reads (never their values).

export function GigsSources({
  sources,
  catalog,
  onChanged,
  onScanned,
}: {
  sources: readonly SourceRow[];
  catalog: readonly CatalogEntry[];
  onChanged: () => Promise<unknown>;
  /** A source's own scan ended: re-read the sources and the gigs. */
  onScanned: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const byAdapter = new Map(catalog.map((c) => [c.adapter, c]));
  const addable = catalog.filter((c) => c.creatable && c.tier !== "C");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-h2 text-ink">{t("sources.title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-steel">{t("sources.lede")}</p>
      </div>
      {sources.length === 0 ? (
        <div className={`${PANEL_SUNKEN} px-6 py-6 text-center`}>
          <p className="font-serif text-h3 text-ink">{t("sources.emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-steel">{t("sources.emptyBody")}</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sources.map((s) => (
            <SourceCard key={s.id} source={s} entry={byAdapter.get(s.adapter) ?? null} onChanged={onChanged} onScanned={onScanned} />
          ))}
        </div>
      )}
      <section>
        <h3 className={`${META_LABEL} mb-2`}>{t("sources.addTitle")}</h3>
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {addable.map((c) => (
            <AddCard key={c.adapter} entry={c} already={sources.filter((s) => s.adapter === c.adapter).length} onChanged={onChanged} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function useAdapterLabel() {
  const t = useTranslations("gigs");
  return (entry: CatalogEntry | null, adapter: string) => {
    const key = `adapter.${adapter}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : (entry?.label ?? adapter);
  };
}

function KeyHint({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations("gigs");
  if (entry.envVars.length === 0) return <p className="text-sm text-steel">{t("sources.noKeyNeeded")}</p>;
  return (
    <div className="text-sm">
      <p className="text-ink">
        {entry.needsKey ? t("sources.needsKey") : t("sources.optionalKey")}{" "}
        {entry.envVars.map((v, i) => (
          <span key={v}>
            {i > 0 ? ", " : null}
            <code className="rounded bg-stone-100 px-1 font-mono text-sm">{v}</code>
          </span>
        ))}
      </p>
      <p className="mt-0.5 text-steel">
        <span className="font-semibold">{t("sources.keyless")}</span> {entry.keylessBehaviour}
      </p>
    </div>
  );
}

const STREAK_TONE: Record<StreakTone, string> = {
  calm: "text-ink",
  watch: "text-amber-700",
  near: "text-coral",
  at: "text-red-800",
};

function SourceCard({
  source,
  entry,
  onChanged,
  onScanned,
}: {
  source: SourceRow;
  entry: CatalogEntry | null;
  onChanged: () => Promise<unknown>;
  onScanned: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const label = useAdapterLabel();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const running = source.enabled && !source.pausedReason;
  const needsAck = source.tier === "B" && (!source.termsCurrent || source.pausedReason === "terms_review");
  const tone = streakTone(source.invalidStreak, GIG_INVALID_STREAK_LIMIT);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/sources/${encodeURIComponent(source.id)}`, "PATCH", body);
    setBusy(false);
    if (!res.ok) setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
    // A changed summary answers 409 with the new hash: re-read so the panel shows it.
    await onChanged();
  }

  // Why this source cannot be scanned now, as visible text beside the disabled button
  // (the scan door refuses a paused or disabled source; it never un-pauses one).
  const scanBlocked = needsAck
    ? t("sources.scanBlockedTerms")
    : source.pausedReason
      ? t("sources.scanBlockedPaused", { reason: fmt.paused(source.pausedReason) })
      : !source.enabled
        ? t("sources.scanBlockedOff")
        : null;

  return (
    <article className={`${PANEL} flex flex-col gap-3 p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${CHIP} text-xs`}>{t("sources.tier", { tier: source.tier })}</span>
            <span className={`${CHIP_QUIET} text-xs`}>{fmt.arena(source.arena)}</span>
            {running ? (
              <span className={`${NOTICE("info")} inline-block px-2 py-0.5 text-xs font-semibold`}>{t("sources.running")}</span>
            ) : (
              <span className={`${NOTICE("amber")} inline-block px-2 py-0.5 text-xs font-semibold`}>{source.pausedReason ? fmt.paused(source.pausedReason) : t("sources.disabled")}</span>
            )}
          </div>
          <div>
            <h3 className="font-serif text-h3 text-ink">{label(entry, source.adapter)}</h3>
            <p className="font-mono text-sm text-steel">{source.host}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={META_LABEL}>{t("sources.streak")}</p>
          <p className={`font-serif text-h3 leading-tight nums ${STREAK_TONE[tone]}`}>
            <span aria-hidden>{t("sources.streakValue", { count: source.invalidStreak, limit: GIG_INVALID_STREAK_LIMIT })}</span>
            <span className="sr-only">{t("sources.streakLine", { count: source.invalidStreak, limit: GIG_INVALID_STREAK_LIMIT })}</span>
          </p>
          {tone === "near" || tone === "at" ? <p className={`text-xs font-semibold ${STREAK_TONE[tone]}`}>{tone === "at" ? t("sources.streakAt") : t("sources.streakNear")}</p> : null}
        </div>
      </div>
      <p className="text-sm text-steel">{t(`sources.tierMeaning.${source.tier}` as Parameters<typeof t>[0])}</p>
      {source.pausedAt ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-steel">{t("sources.pausedSince")}</dt>
          <dd className="text-ink">{fmt.dateTime(source.pausedAt)}</dd>
        </dl>
      ) : null}
      {source.pausedReason ? <p className="text-sm text-ink">{t(`pausedWhy.${source.pausedReason}` as Parameters<typeof t>[0])}</p> : null}
      {entry ? <KeyHint entry={entry} /> : null}

      {needsAck && entry && entry.termsHash ? (
        <div className={`${NOTICE("amber")} space-y-2 px-3 py-3 text-sm`}>
          <p className="font-semibold">{source.acknowledgedAt ? t("sources.termsChanged") : t("sources.termsFirst")}</p>
          <blockquote className="border-l-2 border-amber-600 pl-2">{entry.termsSummary}</blockquote>
          <p className="text-sm">{t("sources.termsIsReading", { date: entry.checkedOn })}</p>
          {entry.termsUrl ? (
            <a href={entry.termsUrl} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline">
              {t("sources.readOriginal")} <ExternalLink size={13} aria-hidden />
            </a>
          ) : null}
          <p className="break-all font-mono text-sm">{t("sources.hash", { hash: entry.termsHash })}</p>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="mt-0.5 h-4 w-4 accent-moss" />
            {t("sources.ackCheck")}
          </label>
          <button type="button" disabled={busy || !read} onClick={() => patch({ action: "acknowledge", termsHash: entry.termsHash })} className={`${BTN_AFFIRM} h-9 px-3 text-sm`}>
            {t("sources.acknowledge")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
          {error}
        </p>
      ) : null}

      <SourceScan source={source} blocked={scanBlocked} onScanned={onScanned}>
        {(scanButton) => (
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-t border-stone-200 pt-3">
            <div className="min-w-0 text-sm">
              <p className={META_LABEL}>{t("sources.lastRun")}</p>
              <p className="text-ink">
                {source.lastRunAt ? t("sources.lastRunLine", { date: fmt.dateTime(source.lastRunAt), outcome: t(`runOutcome.${source.lastOutcome ?? "none"}` as Parameters<typeof t>[0]) }) : <Absent>{t("sources.neverRun")}</Absent>}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {running ? (
                <button type="button" disabled={busy} onClick={() => patch({ action: "pause" })} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
                  {t("sources.pause")}
                </button>
              ) : !needsAck ? (
                <button type="button" disabled={busy} onClick={() => patch({ action: "resume" })} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
                  {source.pausedReason === "invalid_streak" ? t("sources.resumeStreak") : t("sources.resume")}
                </button>
              ) : null}
              {scanButton}
            </div>
          </div>
        )}
      </SourceScan>
    </article>
  );
}

/** One source's own scan: the button (bottom right of the card's footer) and the line
 *  that follows its task - queued, running, finished with the run's outcome and its new
 *  listings, or failed. Two clicks never start two scans: the button is disabled from the
 *  click until the task ends (and the door folds a repeat onto the running task anyway).
 *  The task is followed through the workspace's own task poll (useTaskResult), the same
 *  record the Background tasks tab shows. */
function SourceScan({
  source,
  blocked,
  onScanned,
  children,
}: {
  source: SourceRow;
  /** Why the source cannot be scanned now, or null. */
  blocked: string | null;
  onScanned: () => Promise<unknown>;
  children: (scanButton: ReactNode) => ReactNode;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const { refresh } = useTasks();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const watch = useTaskResult(taskId);
  // Between the 202 and the poll's first sight of the task, the status is unknown: queued.
  const awaitingPoll = taskId !== null && watch.status === null;
  const inFlight = starting || awaitingPoll || watch.active || watch.loading;
  const ended = taskId !== null && (watch.full !== null || watch.resultUnavailable) ? taskId : null;

  // The run ended: re-read the sources (last run, streak, pause) and the gigs, once per task.
  const reloadedFor = useRef<string | null>(null);
  const onScannedRef = useRef(onScanned);
  useEffect(() => {
    onScannedRef.current = onScanned;
  });
  useEffect(() => {
    if (!ended || reloadedFor.current === ended) return;
    reloadedFor.current = ended;
    void onScannedRef.current();
  }, [ended]);

  async function start() {
    if (inFlight || blocked) return;
    setStarting(true);
    setStartError(null);
    const res = await sendJson("/api/gigs/scan", "POST", { sourceId: source.id });
    setStarting(false);
    const id = res.ok && typeof res.body?.taskId === "string" ? res.body.taskId : null;
    if (!id) {
      setStartError(resolveError(res.body as ApiErrorPayload | null, t("scan.failed")));
      return;
    }
    setTaskId(id);
    refresh();
  }

  let line: { tone: "info" | "critical" | "quiet"; text: string } | null = null;
  if (startError) line = { tone: "critical", text: startError };
  else if (starting) line = { tone: "quiet", text: t("sources.scanStarting") };
  else if (awaitingPoll || watch.status === "queued") line = { tone: "quiet", text: t("sources.scanQueued") };
  else if (watch.status === "running") line = { tone: "quiet", text: watch.progressMsg || t("sources.scanRunning", { host: source.host }) };
  else if (watch.loading) line = { tone: "quiet", text: t("sources.scanReading") };
  else if (watch.status === "failed" || watch.status === "canceled" || watch.status === "interrupted") {
    line = { tone: "critical", text: t("sources.scanFailed", { status: t(`sources.scanStatus.${watch.status}` as Parameters<typeof t>[0]) }) };
  } else if (watch.resultUnavailable) line = { tone: "info", text: t("sources.scanUnknown") };
  else if (watch.full) {
    const view = sourceScanView(watch.full.result, source.id);
    if (view.kind === "ran") {
      const outcome = t(`runOutcome.${view.outcome}` as Parameters<typeof t>[0]);
      const reasonKey = `sources.scanReason.${view.reason ?? ""}` as Parameters<typeof t>[0];
      const reason = view.reason ? (t.has(reasonKey) ? t(reasonKey) : view.reason.replace(/_/g, " ")) : null;
      line = {
        tone: view.outcome === "succeeded" ? "info" : "critical",
        text: reason ? t("sources.scanDoneReason", { outcome, reason, created: view.created, found: view.found }) : t("sources.scanDone", { outcome, created: view.created, found: view.found }),
      };
    } else if (view.kind === "not_run") line = { tone: "info", text: t("sources.scanNotRun") };
    else line = { tone: "info", text: t("sources.scanUnknown") };
  }

  const button = (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {blocked ? <span className="max-w-[18rem] text-right text-sm text-steel">{blocked}</span> : null}
      <button type="button" disabled={inFlight || blocked !== null} onClick={() => void start()} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
        {inFlight ? <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Radar size={14} aria-hidden />} {t("sources.scanThis")}
      </button>
    </span>
  );

  // The run's line sits with the footer at the card's foot, never stranded mid-card when
  // the card beside it is taller.
  return (
    <div className="mt-auto space-y-3">
      {line ? (
        <p role={line.tone === "critical" ? "alert" : "status"} className={line.tone === "quiet" ? "text-sm text-steel" : `${NOTICE(line.tone)} px-3 py-2 text-sm`}>
          {line.text}
          {watch.full?.finishedAt && !inFlight && !startError ? <span> · {fmt.dateTime(watch.full.finishedAt)}</span> : null}
        </p>
      ) : null}
      {children(button)}
    </div>
  );
}

function AddCard({ entry, already, onChanged }: { entry: CatalogEntry; already: number; onChanged: () => Promise<unknown> }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const label = useAdapterLabel();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const res = await sendJson("/api/gigs/sources", "POST", { adapter: entry.adapter });
    setBusy(false);
    if (!res.ok) setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
    else await onChanged();
  }

  return (
    <li className={`${PANEL_SUNKEN} space-y-2 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${CHIP} text-xs`}>{t("sources.tier", { tier: entry.tier })}</span>
        {entry.arena ? <span className={`${CHIP_QUIET} text-xs`}>{fmt.arena(entry.arena)}</span> : null}
      </div>
      <p className="font-semibold text-ink">{label(entry, entry.adapter)}</p>
      <p className="font-mono text-sm text-steel">{entry.host}</p>
      {entry.declines ? <p className="text-sm text-amber-700">{t(`sources.declines.${entry.declines}` as Parameters<typeof t>[0])}</p> : null}
      <KeyHint entry={entry} />
      {entry.tier === "B" ? <p className="text-sm text-steel">{t("sources.addTierB")}</p> : null}
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
          {error}
        </p>
      ) : null}
      <button type="button" disabled={busy} onClick={add} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
        {already > 0 ? t("sources.addAnother", { count: already }) : t("sources.add")}
      </button>
    </li>
  );
}

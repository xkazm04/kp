"use client";

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { GIG_INVALID_STREAK_LIMIT, type Gig, type GigStatus } from "@/app/_lib/gigs/types";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { sourceScanView, streakTone, type CatalogEntry, type SourceRow } from "./gigsLogic";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// Wires: the sources (B/3 "The Proof", renderWires - the owner kept it as B/3 set it).
// Official APIs only. One row per configured source: its tier mark, its name and variant,
// arena, last run, what it filed, its rejected streak as five pips (the fifth rejection in
// a row pauses it), and the two moves a row owns - scan it on its own, pause or resume it.
// The row folds open onto everything the old source card said: the terms (and, for a
// tier-B source, the acknowledgement that enables it), the keyless behaviour, the key
// NAMES it reads (never their values), its config, what it filed by status. The tier key
// is stated once above the rows, not on every card.
//
// A source's scan is POST /api/gigs/scan {sourceId}, followed through the workspace's task
// poll (useTaskResult) to its outcome and new-listing count; the line that follows it sits
// under the row, visible whether the row is open or not. Every write re-reads what it moved.

type Translate = ReturnType<typeof useTranslations<"gigs">>;
type Key = Parameters<Translate>[0];

function adapterLabel(t: Translate, entry: CatalogEntry | null, adapter: string): string {
  const key = `adapter.${adapter}` as Key;
  return t.has(key) ? t(key) : (entry?.label ?? adapter);
}

/** The job categories a Freelancer-style source narrows to, when its config names them. */
function jobsOf(source: SourceRow): string[] | null {
  const jobs = source.config?.jobs;
  return Array.isArray(jobs) ? jobs.map(String) : null;
}

/** Config other than the job categories, as short readable pairs (never a secret: the
 *  store holds none in config). */
function otherConfig(source: SourceRow): [string, string][] {
  return Object.entries(source.config ?? {})
    .filter(([k]) => k !== "jobs")
    .map(([k, v]) => {
      const text = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.map(String).join(", ") : JSON.stringify(v);
      return [k, text.length > 80 ? `${text.slice(0, 79)}…` : text] as [string, string];
    });
}

export function GigsWires({
  sources,
  catalog,
  gigs,
  onChanged,
  onScanned,
}: {
  sources: readonly SourceRow[];
  catalog: readonly CatalogEntry[];
  gigs: readonly Gig[];
  /** After a pause / resume / acknowledge / add: re-read the sources. */
  onChanged: () => Promise<unknown>;
  /** A source's own scan ended: re-read the sources and the gigs. */
  onScanned: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const popId = useId();
  const byAdapter = useMemo(() => new Map(catalog.map((c) => [c.adapter, c])), [catalog]);
  const addable = catalog.filter((c) => c.creatable && c.tier !== "C");

  // "Now" for the relative last-run times, refreshed each minute (not each render).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const filedBy = useMemo(() => {
    const m = new Map<string, Partial<Record<GigStatus, number>>>();
    for (const g of gigs) {
      if (!g.sourceId) continue;
      const row = m.get(g.sourceId) ?? {};
      row[g.status] = (row[g.status] ?? 0) + 1;
      m.set(g.sourceId, row);
    }
    return m;
  }, [gigs]);
  const filedTotal = (id: string) => Object.values(filedBy.get(id) ?? {}).reduce((n, v) => n + (v ?? 0), 0);
  const filed = sources.reduce((n, s) => n + filedTotal(s.id), 0);
  const forwarded = gigs.filter((g) => !g.sourceId).length;
  const ran = sources.filter((s) => s.lastRunAt).length;
  const never = sources.filter((s) => !s.lastRunAt).map((s) => adapterLabel(t, byAdapter.get(s.adapter) ?? null, s.adapter));
  const adapterCount = new Map<string, number>();
  for (const s of sources) adapterCount.set(s.adapter, (adapterCount.get(s.adapter) ?? 0) + 1);

  const deck = [
    t("wires.ran", { count: ran }),
    never.length ? t("wires.neverRan", { count: never.length, names: never.join(", ") }) : null,
    forwarded ? t("wires.forwarded", { count: forwarded }) : null,
    t("wires.pauseRule", { limit: GIG_INVALID_STREAK_LIMIT }),
  ].filter((x): x is string => x !== null);

  const addButton = (
    <button type="button" className="btn quiet wkey-add" popoverTarget={popId}>
      {t("wires.add")}
    </button>
  );

  return (
    <div className="enter">
      <header className="page-head">
        <span className="caps dim">{t("wires.title")}</span>
        <h2 className="t-display">{t("wires.headline", { wires: sources.length, filed })}</h2>
        {sources.length > 0 ? (
          <p className="deck">
            {deck.map((d, i) => (
              <span key={i}>
                {i > 0 ? <span className="sep">·</span> : null}
                {d}
              </span>
            ))}
          </p>
        ) : null}
      </header>

      <div className="wkey">
        <span>
          <span className="tier A" aria-hidden>
            A
          </span>
          {t("wires.keyA")}
        </span>
        <span>
          <span className="tier B" aria-hidden>
            B
          </span>
          {t("wires.keyB")}
        </span>
        <span>
          <span className="pips" aria-hidden>
            {Array.from({ length: GIG_INVALID_STREAK_LIMIT }, (_, i) => (
              <i key={i} className={i === 0 ? "on" : undefined} />
            ))}
          </span>
          {t("wires.keyStreak", { limit: GIG_INVALID_STREAK_LIMIT })}
        </span>
        {addButton}
      </div>

      {sources.length === 0 ? (
        <p className="q-empty">{t("wires.empty")}</p>
      ) : (
        <div className="wires">
          <div className="wires-in">
            <div className="wcols">
              <span>{t("wires.col.tier")}</span>
              <span>{t("wires.col.wire")}</span>
              <span>{t("wires.col.arena")}</span>
              <span>{t("sources.lastRun")}</span>
              <span className="r">{t("wires.col.filed")}</span>
              <span>{t("wires.col.streak")}</span>
              <span className="sr-only">{t("wires.col.actions")}</span>
              <span aria-hidden />
            </div>
            {sources.map((s) => (
              <WireRow
                key={s.id}
                source={s}
                entry={byAdapter.get(s.adapter) ?? null}
                filed={filedBy.get(s.id) ?? {}}
                shared={(adapterCount.get(s.adapter) ?? 0) > 1}
                now={now}
                onChanged={onChanged}
                onScanned={onScanned}
              />
            ))}
          </div>
        </div>
      )}

      <AddWire id={popId} entries={addable} sources={sources} onChanged={onChanged} fmtArena={fmt.arena} />
    </div>
  );
}

function WireRow({
  source,
  entry,
  filed,
  shared,
  now,
  onChanged,
  onScanned,
}: {
  source: SourceRow;
  entry: CatalogEntry | null;
  filed: Partial<Record<GigStatus, number>>;
  /** Another source uses the same adapter: name the variant by its config, not its host. */
  shared: boolean;
  now: Date;
  onChanged: () => Promise<unknown>;
  onScanned: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const format = useFormatter();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const running = source.enabled && !source.pausedReason;
  const needsAck = source.tier === "B" && (!source.termsCurrent || source.pausedReason === "terms_review");
  const tone = streakTone(source.invalidStreak, GIG_INVALID_STREAK_LIMIT);
  const jobs = jobsOf(source);
  const config = otherConfig(source);
  const filedCount = Object.values(filed).reduce((n, v) => n + (v ?? 0), 0);
  const missingKey = entry !== null && entry.needsKey && !source.lastRunAt;

  // Why this source cannot be scanned now; the scan door refuses a paused or disabled
  // source and never un-pauses one.
  const blocked = needsAck
    ? t("sources.scanBlockedTerms")
    : source.pausedReason
      ? t("sources.scanBlockedPaused", { reason: fmt.paused(source.pausedReason) })
      : !source.enabled
        ? t("sources.scanBlockedOff")
        : null;
  const scan = useSourceScan(source, blocked, onScanned);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/sources/${encodeURIComponent(source.id)}`, "PATCH", body);
    setBusy(false);
    if (!res.ok) setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
    // A changed summary answers 409 with the new hash: re-read so the fold shows it.
    await onChanged();
  }

  /** Buttons live in the summary: their click must not also open or close the row. */
  const own = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  const variant = shared ? (jobs ? t("wires.jobCategories", { count: jobs.length }) : t("wires.allCategories")) : source.host;
  const state = source.pausedReason
    ? fmt.paused(source.pausedReason)
    : !source.enabled
      ? t("sources.disabled")
      : needsAck
        ? t("wires.termsWaiting")
        : null;
  const lastRunRef = source.lastRunAt ? new Date(Math.max(now.getTime(), Date.parse(source.lastRunAt))) : now;
  const filedEntries = (Object.entries(filed) as [GigStatus, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <details className={`wire${running ? "" : " paused"}`}>
        <summary>
          <span className={`tier ${source.tier}`} role="img" aria-label={t("sources.tier", { tier: source.tier })}>
            {source.tier}
          </span>
          <span className="wl">
            {adapterLabel(t, entry, source.adapter)}
            <small>
              {variant}
              {missingKey && entry ? ` · ${t("wires.needsVars", { vars: entry.envVars.join(" + ") })}` : null}
              {state ? (
                <>
                  {" · "}
                  <span className="coral">{state}</span>
                </>
              ) : null}
            </small>
          </span>
          <span>{fmt.arena(source.arena)}</span>
          <span>
            {source.lastRunAt ? (
              <>
                {fmt.relative(source.lastRunAt, lastRunRef)} ·{" "}
                <span className={source.lastOutcome === "succeeded" ? undefined : "coral"}>{t(`runOutcome.${source.lastOutcome ?? "none"}` as Key)}</span>
              </>
            ) : (
              <span className="absent">{t("sources.neverRun")}</span>
            )}
          </span>
          {source.lastRunAt || filedCount > 0 ? (
            <span className="found" aria-label={t("wires.filedLabel", { count: filedCount })}>
              {format.number(filedCount)}
            </span>
          ) : (
            <span className="found null" role="img" aria-label={t("wires.neverRunNotZero")}>
              —
            </span>
          )}
          <span className="pips" role="img" aria-label={t("sources.streakLine", { count: source.invalidStreak, limit: GIG_INVALID_STREAK_LIMIT })}>
            {Array.from({ length: GIG_INVALID_STREAK_LIMIT }, (_, i) => (
              <i key={i} className={i < source.invalidStreak ? "on" : undefined} />
            ))}
            <span className={`t${tone === "near" || tone === "at" ? " near" : ""}`} aria-hidden>
              {t("sources.streakValue", { count: source.invalidStreak, limit: GIG_INVALID_STREAK_LIMIT })}
            </span>
          </span>
          <span className="wacts">
            <button
              type="button"
              className="btn quiet"
              aria-disabled={blocked !== null || scan.inFlight ? true : undefined}
              onClick={own(() => (blocked ? scan.nudge() : void scan.start()))}
            >
              {t("wires.scan")}
            </button>
            {running ? (
              <button type="button" className="btn quiet" disabled={busy} onClick={own(() => void patch({ action: "pause" }))}>
                {t("sources.pause")}
              </button>
            ) : !needsAck ? (
              <button type="button" className="btn quiet" disabled={busy} onClick={own(() => void patch({ action: "resume" }))}>
                {source.pausedReason === "invalid_streak" ? t("sources.resumeStreak") : t("sources.resume")}
              </button>
            ) : null}
          </span>
        </summary>

        <div className="inner">
          <div>
            {source.pausedReason ? (
              <div>
                <h3 className="t-h3">{fmt.paused(source.pausedReason)}</h3>
                <p>{t(`pausedWhy.${source.pausedReason}` as Key)}</p>
                {source.pausedAt ? (
                  <p className="t-meta">
                    {t("sources.pausedSince")} {fmt.dateTime(source.pausedAt)}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              <h3 className="t-h3">{t("wires.terms")}</h3>
              {!entry ? (
                <p className="t-meta">{t("wires.noCatalog")}</p>
              ) : needsAck && entry.termsHash ? (
                <div className="terms">
                  <p className="strong">{source.acknowledgedAt ? t("sources.termsChanged") : t("sources.termsFirst")}</p>
                  <blockquote>{entry.termsSummary}</blockquote>
                  <p>{t("sources.termsIsReading", { date: entry.checkedOn })}</p>
                  {entry.termsUrl ? (
                    <p>
                      <a href={entry.termsUrl} target="_blank" rel="noopener noreferrer" className="linkbtn">
                        {t("sources.readOriginal")}
                      </a>
                    </p>
                  ) : null}
                  <p>
                    <code>{t("sources.hash", { hash: entry.termsHash })}</code>
                  </p>
                  <label className="check-line">
                    <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
                    {t("sources.ackCheck")}
                  </label>
                  <div>
                    <button type="button" className="btn affirm" disabled={busy || !read} onClick={() => void patch({ action: "acknowledge", termsHash: entry.termsHash })}>
                      {t("sources.acknowledge")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p>{entry.termsSummary}</p>
                  <p className="t-meta">
                    {entry.termsUrl ? (
                      <>
                        <a href={entry.termsUrl} target="_blank" rel="noopener noreferrer" className="linkbtn">
                          {t("sources.readOriginal")}
                        </a>
                        {" · "}
                      </>
                    ) : null}
                    {t("wires.checkedOn", { date: entry.checkedOn })}
                    {source.acknowledgedAt ? ` · ${t("wires.acknowledgedOn", { date: fmt.date(source.acknowledgedAt) })}` : null}
                  </p>
                </>
              )}
            </div>

            {entry ? (
              <div>
                <h3 className="t-h3">{t("wires.withoutKey")}</h3>
                <p>{entry.keylessBehaviour}</p>
              </div>
            ) : null}
          </div>

          <div>
            <div>
              <h3 className="t-h3">{t("wires.keys")}</h3>
              {entry && entry.envVars.length > 0 ? (
                <p>
                  {entry.envVars.map((v, i) => (
                    <span key={v}>
                      {i > 0 ? " " : null}
                      <code className="env">{v}</code>
                    </span>
                  ))}{" "}
                  <span className="t-meta">{entry.needsKey ? t("wires.keysRequired") : t("wires.keysOptional")}</span>
                </p>
              ) : (
                <p className="t-meta">{t("wires.keysNone")}</p>
              )}
            </div>

            <div>
              <h3 className="t-h3">{t("wires.config")}</h3>
              {jobs ? (
                <>
                  <p className="t-meta">{t("wires.jobCategories", { count: jobs.length })}</p>
                  <div className="cats">
                    {jobs.map((j) => (
                      <span key={j}>#{j}</span>
                    ))}
                  </div>
                </>
              ) : null}
              {config.length > 0 ? (
                <dl className="kv">
                  {config.map(([k, v]) => (
                    <div key={k} style={{ display: "contents" }}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : !jobs ? (
                <p className="t-meta">{shared ? t("wires.configEvery") : t("wires.configDefaults")}</p>
              ) : null}
            </div>

            <div>
              <h3 className="t-h3">{t("sources.streak")}</h3>
              <p className={tone === "near" || tone === "at" ? "coral" : undefined}>
                {t("sources.streakLine", { count: source.invalidStreak, limit: GIG_INVALID_STREAK_LIMIT })}
                {tone === "near" ? ` · ${t("sources.streakNear")}` : tone === "at" ? ` · ${t("sources.streakAt")}` : null}
              </p>
            </div>

            <div>
              <h3 className="t-h3">{t("sources.lastRun")}</h3>
              <p>
                {source.lastRunAt ? (
                  t("sources.lastRunLine", { date: fmt.dateTime(source.lastRunAt), outcome: t(`runOutcome.${source.lastOutcome ?? "none"}` as Key) })
                ) : (
                  <span className="absent">{t("sources.neverRun")}</span>
                )}
              </p>
            </div>

            <div>
              <h3 className="t-h3">{t("wires.filedTitle")}</h3>
              {filedEntries.length === 0 ? (
                <p className="t-meta">{source.lastRunAt ? t("wires.filedNone") : t("wires.neverRunNotZero")}</p>
              ) : (
                <p className="t-meta">
                  {filedEntries.map(([k, n], i) => (
                    <span key={k}>
                      {i > 0 ? " · " : null}
                      {fmt.status(k)} <b className="strong">{format.number(n)}</b>
                    </span>
                  ))}
                </p>
              )}
            </div>

            {error ? (
              <p role="alert" className="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </details>
      {scan.line ? (
        <p role={scan.line.tone === "critical" ? "alert" : "status"} className={`runline ${scan.line.tone === "critical" ? "coral" : scan.line.tone === "quiet" ? "t-meta" : ""}`}>
          {scan.line.text}
          {scan.finishedAt ? <span className="dim"> · {fmt.dateTime(scan.finishedAt)}</span> : null}
        </p>
      ) : null}
    </>
  );
}

/** One source's own scan: start it, follow its task through the workspace's task poll
 *  (useTaskResult, the record the Background tasks tab shows) to its outcome, and re-read
 *  the sources and the gigs once when it ends. Two clicks never start two scans: the
 *  button is inert from the click until the task ends (and the door folds a repeat onto
 *  the running task anyway). A click on a blocked scan says why, in the row's line. */
function useSourceScan(source: SourceRow, blocked: string | null, onScanned: () => Promise<unknown>) {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const { refresh } = useTasks();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [nudged, setNudged] = useState(false);
  const watch = useTaskResult(taskId);
  // Between the 202 and the poll's first sight of the task, the status is unknown: queued.
  const awaitingPoll = taskId !== null && watch.status === null;
  const inFlight = starting || awaitingPoll || watch.active || watch.loading;
  const ended = taskId !== null && (watch.full !== null || watch.resultUnavailable) ? taskId : null;

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
    setNudged(false);
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
    line = { tone: "critical", text: t("sources.scanFailed", { status: t(`sources.scanStatus.${watch.status}` as Key) }) };
  } else if (watch.resultUnavailable) line = { tone: "info", text: t("sources.scanUnknown") };
  else if (watch.full) {
    const view = sourceScanView(watch.full.result, source.id);
    if (view.kind === "ran") {
      const outcome = t(`runOutcome.${view.outcome}` as Key);
      const reasonKey = `sources.scanReason.${view.reason ?? ""}` as Key;
      const reason = view.reason ? (t.has(reasonKey) ? t(reasonKey) : view.reason.replace(/_/g, " ")) : null;
      line = {
        tone: view.outcome === "succeeded" ? "info" : "critical",
        text: reason ? t("sources.scanDoneReason", { outcome, reason, created: view.created, found: view.found }) : t("sources.scanDone", { outcome, created: view.created, found: view.found }),
      };
    } else if (view.kind === "not_run") line = { tone: "info", text: t("sources.scanNotRun") };
    else line = { tone: "info", text: t("sources.scanUnknown") };
  } else if (nudged && blocked) line = { tone: "quiet", text: blocked };

  const finishedAt = watch.full?.finishedAt && !inFlight && !startError ? watch.full.finishedAt : null;
  return { start, inFlight, line, finishedAt, nudge: () => setNudged(true) };
}

/** "Add a wire": the catalog's creatable adapters, in a popover opened from the key row. */
function AddWire({
  id,
  entries,
  sources,
  onChanged,
  fmtArena,
}: {
  id: string;
  entries: readonly CatalogEntry[];
  sources: readonly SourceRow[];
  onChanged: () => Promise<unknown>;
  fmtArena: (a: string) => string;
}) {
  const t = useTranslations("gigs");
  return (
    <div id={id} popover="auto" className="pop">
      <h3 className="t-h3">{t("wires.addTitle", { count: entries.length })}</h3>
      {entries.map((c) => (
        <AddRow key={c.adapter} entry={c} already={sources.filter((s) => s.adapter === c.adapter).length} onChanged={onChanged} fmtArena={fmtArena} />
      ))}
    </div>
  );
}

function AddRow({ entry, already, onChanged, fmtArena }: { entry: CatalogEntry; already: number; onChanged: () => Promise<unknown>; fmtArena: (a: string) => string }) {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  async function add() {
    setBusy(true);
    setError(null);
    setAdded(false);
    const res = await sendJson("/api/gigs/sources", "POST", { adapter: entry.adapter });
    setBusy(false);
    if (!res.ok) setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
    else {
      setAdded(true);
      await onChanged();
    }
  }

  const keyNote = entry.needsKey
    ? t("wires.needsVars", { vars: entry.envVars.join(" + ") })
    : entry.envVars.length > 0
      ? t("wires.keysOptional")
      : t("wires.keysNone");

  return (
    <div className="pi">
      <span className={`tier ${entry.tier}`} role="img" aria-label={t("sources.tier", { tier: entry.tier })}>
        {entry.tier}
      </span>
      <span>
        <b>{adapterLabel(t, entry, entry.adapter)}</b>
        <span className="d">
          {[entry.arena ? fmtArena(entry.arena) : null, entry.host ?? t("wires.noHost"), keyNote].filter(Boolean).join(" · ")}
        </span>
        {entry.declines ? <span className="d coral">{t(`sources.declines.${entry.declines}` as Key)}</span> : null}
        {entry.tier === "B" ? <span className="d">{t("sources.addTierB")}</span> : null}
        {added ? (
          <span role="status" className="d moss">
            {t("wires.added")}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="d coral">
            {error}
          </span>
        ) : null}
      </span>
      <button type="button" className="btn quiet" disabled={busy} onClick={() => void add()}>
        {already > 0 ? t("sources.addAnother", { count: already }) : t("sources.add")}
      </button>
    </div>
  );
}

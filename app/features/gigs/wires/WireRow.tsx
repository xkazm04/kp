"use client";

import { useState, type MouseEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { GIG_INVALID_STREAK_LIMIT, type GigStatus } from "@/app/_lib/gigs/types";
import { streakTone } from "../logic/line";
import type { CatalogEntry, SourceRow } from "../logic/wire";
import { sendJson } from "../data/useGigsData";
import { useGigsFormat } from "../data/useGigsFormat";
import { useSourceScan } from "./useSourceScan";
import { WireDetail } from "./WireDetail";
import { adapterLabel, jobsOf, type Key } from "./wireConfig";

/** One configured source as a folding row: tier, name and variant, arena, last run, what it
 *  filed, the rejected streak as pips, and the two moves a row owns (scan it, pause or
 *  resume it). The fold is WireDetail.tsx; the scan's line sits under the row, visible
 *  whether the row is open or not. */
export function WireRow({
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
  const running = source.enabled && !source.pausedReason;
  const needsAck = source.tier === "B" && (!source.termsCurrent || source.pausedReason === "terms_review");
  const tone = streakTone(source.invalidStreak, GIG_INVALID_STREAK_LIMIT);
  const jobs = jobsOf(source);
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

        <WireDetail source={source} entry={entry} filed={filed} shared={shared} needsAck={needsAck} busy={busy} error={error} onPatch={patch} />
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

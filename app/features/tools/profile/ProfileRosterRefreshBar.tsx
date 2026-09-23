"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, EYEBROW, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { RosterProfile, StaleMap } from "./ProfileRosterTypes";
import {
  planBulkRefresh,
  runBulkRefresh,
  tallyOutcomes,
  type BulkRefreshResult,
  type RefreshEntry,
} from "./profileBulkRefresh";

// The roster's counted batch refresh (challenge-r05 profile-roster-matrix/B). It sits
// above the table and speaks only when the list IN VIEW holds a profile with a newer CV:
// it counts first (clean vs carrying your edits), asks once, walks the clean ones
// through the editor's own PUT (profileBulkRefresh.runBulkRefresh), and reports each
// outcome. It never writes an edited profile: those come back as a review queue whose
// Review opens the same per-profile merge dialog as the row's Rebuild.

type Phase = { kind: "idle" } | { kind: "confirm" } | { kind: "running"; done: number; total: number };

export function ProfileRosterRefreshBar({
  rowsInView,
  stale,
  onReview,
  onRefreshed,
}: {
  /** The roster's filtered rows (every page) — the population the bar counts. */
  rowsInView: readonly RosterProfile[];
  stale: StaleMap;
  /** Open the per-profile rebuild for one edited profile (divergence check + merge). */
  onReview: (id: string, newerSlug: string) => void;
  /** The run wrote something: re-read the population so badges show the server's truth. */
  onRefreshed: () => void;
}) {
  const t = useTranslations("profile.roster.bulkRefresh");
  const errMsg = useErrorMessage();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [result, setResult] = useState<BulkRefreshResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const plan = useMemo(() => planBulkRefresh(rowsInView, stale), [rowsInView, stale]);
  const names = useMemo(() => new Map(rowsInView.map((r) => [r.id, r.label])), [rowsInView]);
  // The review queue as it stands NOW: an edited profile reviewed (and saved) since the
  // run is no longer stale after the re-read, so it leaves the list by itself.
  const reviewNow = useMemo(
    () => (result ? result.review.filter((r) => Object.hasOwn(stale, r.id)) : plan.edited),
    [result, stale, plan.edited]
  );

  const running = phase.kind === "running";
  if (!running && !result && plan.clean.length === 0 && plan.edited.length === 0) return null;

  const start = async () => {
    const rows: RefreshEntry[] = [...plan.clean, ...plan.edited];
    const controller = new AbortController();
    controllerRef.current = controller;
    setResult(null);
    setPhase({ kind: "running", done: 0, total: plan.clean.length });
    const out = await runBulkRefresh({
      rows,
      fetch: (input, init) => fetch(input, init),
      signal: controller.signal,
      onProgress: (done, total) => setPhase({ kind: "running", done, total }),
    });
    controllerRef.current = null;
    setResult(out);
    setPhase({ kind: "idle" });
    if (out.outcomes.some((o) => o.outcome === "refreshed" || o.outcome === "changedSince")) onRefreshed();
  };

  const tally = result ? tallyOutcomes(result.outcomes) : null;
  const failures = result ? result.outcomes.filter((o) => o.outcome === "failed") : [];

  return (
    <section aria-label={t("regionLabel")} className={`${PANEL_SUNKEN} space-y-3 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className={EYEBROW}>{t("eyebrow")}</p>
          {result && tally ? (
            <div role="status" className="space-y-1.5">
              <p className="text-sm font-semibold text-ink">{t("resultTitle")}</p>
              <ul className="flex flex-wrap gap-1.5">
                <li className={CHIP_QUIET}>{t("refreshed", { count: tally.refreshed })}</li>
                {tally.changedSince ? <li className={CHIP_QUIET}>{t("changedSince", { count: tally.changedSince })}</li> : null}
                {tally.failed ? <li className={CHIP_QUIET}>{t("failed", { count: tally.failed })}</li> : null}
                {tally.notAttempted ? <li className={CHIP_QUIET}>{t("notAttempted", { count: tally.notAttempted })}</li> : null}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-ink">
              {t("summary", { clean: plan.clean.length })}{" "}
              {plan.edited.length ? t("edited", { count: plan.edited.length }) : null}
            </p>
          )}
          {running ? (
            <p role="status" className="text-sm text-steel nums">
              {t("progress", { done: phase.done, total: phase.total })}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {running ? (
            <button type="button" onClick={() => controllerRef.current?.abort()} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
              {t("stop")}
            </button>
          ) : phase.kind === "confirm" ? (
            <>
              <button type="button" onClick={() => void start()} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
                <RefreshCw size={14} aria-hidden /> {t("confirm")}
              </button>
              <button type="button" autoFocus onClick={() => setPhase({ kind: "idle" })} className={`${BTN_GHOST} h-9 px-3 text-sm`}>
                {t("cancel")}
              </button>
            </>
          ) : result ? (
            <button type="button" onClick={() => setResult(null)} className={`${BTN_GHOST} h-9 px-3 text-sm`}>
              {t("dismiss")}
            </button>
          ) : plan.clean.length ? (
            <button type="button" onClick={() => setPhase({ kind: "confirm" })} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
              <RefreshCw size={14} aria-hidden /> {t("run", { count: plan.clean.length })}
            </button>
          ) : null}
        </div>
      </div>

      {phase.kind === "confirm" ? (
        <p className="text-sm text-steel">{t("confirmPrompt", { count: plan.clean.length })}</p>
      ) : null}

      {result?.stopped ? (
        <p role="status" className={`${NOTICE(result.stopped === "throttled" ? "amber" : "info")} px-3 py-2 text-sm`}>
          {t(result.stopped)}
        </p>
      ) : null}

      {failures.length ? (
        <ul className="space-y-1 text-sm text-steel">
          {failures.map((f) => (
            <li key={f.id}>
              {t("failedRow", {
                name: names.get(f.id) ?? f.id,
                reason: f.reason === "noNewerProfile" ? t("noNewerProfile") : errMsg({ code: f.reason ?? null }, t("failedGeneric")),
              })}
            </li>
          ))}
        </ul>
      ) : null}

      {!running && reviewNow.length ? (
        <div className="space-y-2">
          <p className="text-sm text-steel">{t("reviewTitle", { count: reviewNow.length })}</p>
          <ul className="flex flex-wrap gap-2">
            {reviewNow.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onReview(r.id, r.newerSlug)}
                  title={t("reviewTitleRow", { name: names.get(r.id) ?? r.id })}
                  className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}
                >
                  <RefreshCw size={13} aria-hidden /> {t("reviewRow", { name: names.get(r.id) ?? r.id })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

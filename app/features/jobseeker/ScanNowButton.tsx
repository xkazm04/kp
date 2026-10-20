"use client";

import { useTranslations } from "next-intl";
import { Loader2, Radar } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { isScanProgressPhase } from "@/app/_lib/jobseeker/types";
import { FailureNotice } from "./FailureNotice";
import type { ScanTaskState } from "./useScanTask";

// The "Scan now" door, shared by the feed's empty state and the Scans page. The
// caller owns the task state (useScanTask) so it can react to the finish (refresh the
// feed, re-read the schedule); this renders the button, the live progress line and
// the refusal by code. `variant` picks the recipe: the empty state's primary call, or
// the Scans page's secondary control beside the clock toggle.

/** The two lines every scan door shares, so the Sieve's pill and this button never word
 *  one scan two ways:
 *   - `progress`: the live line. While a source is read the task reports ITS host with
 *     done/total counting that source's detail reads, so the line says "jobs.example ·
 *     12 of 60" — it used to hide the name whenever a total existed and sat on "0 of 7".
 *     A phase message (structure / match / deep-dive…) is a closed code, translated.
 *   - `partial`: a scan that FINISHED with a failed phase (its summary's `failures`) says
 *     so by code; a "succeeded" task whose scoring threw is not a quiet success. */
export function useScanLines(scan: ScanTaskState): { progress: string | null; partial: string | null } {
  const t = useTranslations("me.jobs.scan");
  const resolveError = useErrorMessage();
  const msg = scan.progressMsg;
  const label = msg ? (isScanProgressPhase(msg) ? t(`phase.${msg}`) : msg) : null;
  const progress =
    scan.progressTotal > 0
      ? label
        ? t("progressAt", { label, done: scan.progressDone, total: scan.progressTotal })
        : t("progress", { done: scan.progressDone, total: scan.progressTotal })
      : label;
  const failures = scan.status === "succeeded" && Array.isArray(scan.summary?.failures) ? scan.summary.failures : [];
  const first = failures[0] ?? null;
  const partial = first ? t(`partial.${first.phase}`, { msg: resolveError({ code: first.code }, first.code) }) : null;
  return { progress, partial };
}

// `quiet` keeps the button and drops its notices: the feed mounts this door twice while
// its empty state is on screen (header chrome + the empty state's own CTA), and both
// read ONE task state, so one failure painted two identical red notices (smoke,
// 2026-09-16). The empty state's copy is the one under the reader's eye; the header's
// stays a plain button until rows exist.
export function ScanNowButton({ scan, variant = "primary", quiet = false }: { scan: ScanTaskState & { start(): Promise<void> }; variant?: "primary" | "secondary"; quiet?: boolean }) {
  const t = useTranslations("me.jobs.scan");
  // The run's stored failure is a code when the runtime authored it (tasks.ts).
  const resolveError = useErrorMessage();
  const busy = scan.starting || scan.active;
  const recipe = variant === "primary" ? BTN_PRIMARY : BTN_SECONDARY;
  const { progress, partial } = useScanLines(scan);
  return (
    <div className="space-y-2">
      <button type="button" className={`${recipe} h-10 gap-2 px-4`} disabled={busy} onClick={() => void scan.start()} aria-busy={busy || undefined}>
        {busy ? <Loader2 size={15} aria-hidden className="animate-spin" /> : <Radar size={15} aria-hidden />}
        {busy ? t("running") : t("cta")}
      </button>
      {quiet ? null : (
        <>
      {busy && progress ? (
        // The live line is neutral CONTEXT, not a caveat: `NOTICE("info")`, the same
        // advisory shape every other surface in the studio uses, rather than a bare
        // paragraph that reads as body copy under a button.
        <p className={`${NOTICE("info")} px-3 py-1.5 text-sm`} role="status">
          {progress}
        </p>
      ) : null}
      {!busy && partial ? (
        // The run finished, but a phase of it threw: the amber caveat, not the red
        // failure — whatever the other phases landed is on screen and real.
        <p className={`${NOTICE("amber")} px-3 py-1.5 text-micro`} role="status">
          {partial}
        </p>
      ) : null}
      {scan.unreachable ? (
        // …and the caveat is the amber one. It was a raw `text-amber-700` line, which
        // is a status color spelled by hand beside the recipe written for it.
        <p className={`${NOTICE("amber")} px-3 py-1.5 text-sm`} role="status">
          {t("unreachable")}
        </p>
      ) : null}
      {scan.status === "failed" || scan.status === "interrupted" || scan.status === "canceled" ? (
        // The task's own stored diagnostic (no code to resolve); the button above IS
        // the retry, so this notice carries none of its own.
        <FailureNotice fallback={scan.error ? t("failedMsg", { msg: resolveError({ code: scan.error }, scan.error) }) : t("failed")} />
      ) : null}
      {scan.startError ? <FailureNotice failure={scan.startError} fallback={t("startError")} onRetry={() => void scan.start()} retrying={busy} /> : null}
        </>
      )}
    </div>
  );
}

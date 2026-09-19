"use client";

import { useTranslations } from "next-intl";
import { Loader2, Radar } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import { FailureNotice } from "./FailureNotice";
import type { ScanTaskState } from "./useScanTask";

// The "Scan now" door, shared by the feed's empty state and the Scans page. The
// caller owns the task state (useScanTask) so it can react to the finish (refresh the
// feed, re-read the schedule); this renders the button, the live progress line and
// the refusal by code. `variant` picks the recipe: the empty state's primary call, or
// the Scans page's secondary control beside the clock toggle.

// `quiet` keeps the button and drops its notices: the feed mounts this door twice while
// its empty state is on screen (header chrome + the empty state's own CTA), and both
// read ONE task state, so one failure painted two identical red notices (smoke,
// 2026-09-16). The empty state's copy is the one under the reader's eye; the header's
// stays a plain button until rows exist.
export function ScanNowButton({ scan, variant = "primary", quiet = false }: { scan: ScanTaskState & { start(): Promise<void> }; variant?: "primary" | "secondary"; quiet?: boolean }) {
  const t = useTranslations("me.jobs.scan");
  const busy = scan.starting || scan.active;
  const recipe = variant === "primary" ? BTN_PRIMARY : BTN_SECONDARY;
  const progress =
    scan.progressTotal > 0 ? t("progress", { done: scan.progressDone, total: scan.progressTotal }) : scan.progressMsg ? scan.progressMsg : null;
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
        <FailureNotice fallback={scan.error ? t("failedMsg", { msg: scan.error }) : t("failed")} />
      ) : null}
      {scan.startError ? <FailureNotice failure={scan.startError} fallback={t("startError")} onRetry={() => void scan.start()} retrying={busy} /> : null}
        </>
      )}
    </div>
  );
}

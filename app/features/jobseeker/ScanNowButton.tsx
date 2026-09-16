"use client";

import { useTranslations } from "next-intl";
import { Loader2, Radar } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { ScanTaskState } from "./useScanTask";

// The "Scan now" door, shared by the feed's empty state and the Scans page. The
// caller owns the task state (useScanTask) so it can react to the finish (refresh the
// feed, re-read the schedule); this renders the button, the live progress line and
// the refusal by code. `variant` picks the recipe: the empty state's primary call, or
// the Scans page's secondary control beside the clock toggle.

export function ScanNowButton({ scan, variant = "primary" }: { scan: ScanTaskState & { start(): Promise<void> }; variant?: "primary" | "secondary" }) {
  const t = useTranslations("me.jobs.scan");
  const resolveError = useErrorMessage();
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
      {busy && progress ? (
        <p className="text-sm text-steel" role="status">
          {progress}
        </p>
      ) : null}
      {scan.unreachable ? (
        <p className="text-sm text-amber-700" role="status">
          {t("unreachable")}
        </p>
      ) : null}
      {scan.status === "failed" || scan.status === "interrupted" || scan.status === "canceled" ? (
        <p className="text-sm text-red-700" role="status">
          {scan.error ? t("failedMsg", { msg: scan.error }) : t("failed")}
        </p>
      ) : null}
      {scan.startError ? (
        <p className="text-sm text-red-700" role="alert">
          {resolveError(scan.startError, t("startError"))}
        </p>
      ) : null}
    </div>
  );
}

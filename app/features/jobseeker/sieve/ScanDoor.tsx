"use client";

import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { ScanTaskState } from "../useScanTask";
import { cx, SV_BTN, SV_BTN_SM } from "./sieveRecipes";

// "Scan now", in the Sieve's pill. The flow owns ONE scan task (useScanTask) and hands
// this door to every step that can offer it (the sieve's head, the "what you want" note,
// an empty sieve), so two doors never start two scans and every door shows the same
// progress. The live line and a refusal render beside the button, by code, never as the
// thrown message.

export function ScanDoor({ scan, small = false, quiet = false }: { scan: ScanTaskState & { start(): Promise<void> }; small?: boolean; quiet?: boolean }) {
  const t = useTranslations("me.jobs.scan");
  const resolveError = useErrorMessage();
  const busy = scan.starting || scan.active;
  const progress = scan.progressTotal > 0 ? t("progress", { done: scan.progressDone, total: scan.progressTotal }) : scan.progressMsg;
  const failed = scan.status === "failed" || scan.status === "interrupted" || scan.status === "canceled";
  return (
    <span className="scanline">
      <button type="button" className={cx(small ? SV_BTN_SM : SV_BTN)} disabled={busy} aria-busy={busy || undefined} onClick={() => void scan.start()}>
        {busy ? t("running") : t("cta")}
      </button>
      {quiet ? null : (
        <span role="status" aria-live="polite">
          {busy && progress ? progress : null}
          {scan.unreachable ? t("unreachable") : null}
          {failed ? (scan.error ? t("failedMsg", { msg: resolveError({ code: scan.error }, scan.error) }) : t("failed")) : null}
          {scan.startError ? resolveError(scan.startError, t("startError")) : null}
        </span>
      )}
    </span>
  );
}

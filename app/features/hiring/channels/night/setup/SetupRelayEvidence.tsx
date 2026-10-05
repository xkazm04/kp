"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, KeyValueGrid, formatCount } from "@/app/_components/kit";
import type { VerdictCounts } from "../channelsNightPlumbing";

/**
 * What the relay has carried, from the ledger's own verdicts (countVerdicts over the loaded window):
 * delivered (sent + recovered), queued (recorded, not delivered; with no relay: NOT being sent),
 * what needs a person (failed + bounced with a door open), unmatched receipts. With no relay nothing
 * could have been sent, so "needs you" and "unmatched" are a dash with that reason, never a
 * flattering 0. The queue opens from here (the level's own action opens the whole ledger).
 */
export function SetupRelayEvidence({ counts: c, relayOn, onOpenLedger }: {
  counts: VerdictCounts | null;
  relayOn: boolean;
  onOpenLedger: (el: HTMLElement, verdict: "queued") => void;
}) {
  const ts = useTranslations("channelsNight.setup.relay");
  const tk = useTranslations("channels.kit");
  const headId = useId();
  const locale = useLocale();
  const n = (v: number) => formatCount(v, locale);
  return (
    <section className="cns-evidence" aria-labelledby={headId}>
      <h3 className="cns-evidence__title" id={headId}>
        {ts("carried")}
      </h3>
      <KeyValueGrid
        cols={4}
        items={[
          {
            label: ts("delivered"),
            value: c ? <>{n(c.delivered)}{c.delivered > 0 ? <span className="cns-sub"> {ts("deliveredSub", { sent: c.sent, recovered: c.recovered })}</span> : null}</> : null,
            absent: tk("notRead"),
          },
          {
            label: ts("queued"),
            value: c ? <>{n(c.queued)} <span className="cns-sub" data-bad={!relayOn && c.queued > 0 ? "1" : undefined}>{relayOn ? ts("queuedSub") : ts("queuedNotSent")}</span></> : null,
            absent: tk("notRead"),
          },
          {
            label: ts("needs"),
            value: c && (relayOn || c.needs > 0) ? <>{n(c.needs)}{c.needs > 0 ? <span className="cns-sub"> {ts("needsSub", { failed: c.needsFailed, bounced: c.needsBounced })}</span> : null}</> : null,
            absent: c ? ts("needsAbsent") : tk("notRead"),
          },
          {
            label: ts("unmatched"),
            value: c && (relayOn || c.orphaned > 0) ? n(c.orphaned) : null,
            absent: c ? ts("unmatchedAbsent") : tk("notRead"),
          },
        ]}
      />
      {c && c.queued > 0 ? (
        <div className="cns-row">
          <Button label={ts("reviewQueue")} icon="right" size="sm" onClick={(e) => onOpenLedger(e.currentTarget, "queued")} />
        </div>
      ) : null}
    </section>
  );
}

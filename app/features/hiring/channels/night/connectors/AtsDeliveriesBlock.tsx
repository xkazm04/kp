"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { SetupCard, SetupResult, SetupStatus } from "../setup/SetupBits";
import { deadDeliveries, type AtsDeliveries, type AtsDeliveryWire } from "./atsDeliveriesModel";
import type { ReplayOutcome } from "./connectorsDeckReads";

/** The webhook's events, in the reader's words (ICU select keys cannot carry the dot). */
const EVENT_KEY = {
  "candidate.hired": "ats.event.candidateHired",
  "candidate.rejected": "ats.event.candidateRejected",
  "offer.accepted": "ats.event.offerAccepted",
  "offer.declined": "ats.event.offerDeclined",
  ping: "ats.event.ping",
} as const;
const eventKey = (e: string) => (e in EVENT_KEY ? EVENT_KEY[e as keyof typeof EVENT_KEY] : "ats.event.other");

/**
 * The outbound ATS delivery ledger (GET /api/ats/deliveries, the route as it is): the three
 * counts in words (due to retry, dead, stranded) and every dead-lettered row with Replay, which
 * is the route's own POST { replayId } (requeue under the same ledger id, then a sweep). The
 * dead count is also the plumbing's need `atsDead`, so the recruiter hears it on level 0.
 */
export function AtsDeliveriesBlock({ ats, replaying, onReplay }: {
  ats: AtsDeliveries | null;
  replaying: number | null;
  onReplay: (id: number) => Promise<ReplayOutcome>;
}) {
  const t = useTranslations("channelsNight.connectors");
  const errMsg = useErrorMessage();
  const rel = useRelativeTime();
  // One note for the block, not per row: a replay that delivers takes its row off the dead list.
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (ats === null) return <SetupStatus condition="unknown" title={t("ats.notRead")} />;
  const dead = deadDeliveries(ats);

  const replay = async (row: AtsDeliveryWire) => {
    const out = await onReplay(row.id);
    const text = out.ok ? t("ats.replayed") : errMsg(out.code ? { code: out.code } : null, t("ats.replayFailed"));
    setNote({ ok: out.ok, text });
  };

  return (
    <>
      <SetupStatus
        condition={ats.dead > 0 ? "fail" : ats.due > 0 || ats.stranded > 0 || ats.rows.length === 0 ? "wait" : "live"}
        loud={ats.dead > 0}
        title={ats.dead > 0 ? t("ats.dead", { count: ats.dead }) : ats.rows.length === 0 ? t("ats.empty") : t("ats.noneDead")}
        fact={t("ats.counts", { due: ats.due, stranded: ats.stranded })}
      />
      {note ? <SetupResult ok={note.ok}>{note.text}</SetupResult> : null}
      {dead.length > 0 ? (
        <ul className="cns-cards" aria-label={t("ats.deadList")}>
          {dead.map((row) => (
            <SetupCard key={row.id} title={t(eventKey(row.event))} condition="fail" words={t("ats.deadChip")}>
              <p className="cns-help">
                {t("ats.gaveUp", { attempts: row.attempts, time: rel(row.updatedAt) })}
                {row.lastError ? ` ${t("ats.lastAnswer", { answer: row.lastError })}` : ""}
              </p>
              <div className="cns-row">
                <Button label={t("ats.replay")} loadingLabel={t("ats.replaying")} loading={replaying === row.id} onClick={() => void replay(row)} />
              </div>
            </SetupCard>
          ))}
        </ul>
      ) : null}
    </>
  );
}

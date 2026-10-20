"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Mark } from "@/app/_components/kit";
import type { RelayFact } from "./channelsNightLedgerModel";

/**
 * The post book's first line when the relay says something about the rows under it. With no
 * relay it is the loudest thing on the level: "N messages are NOT being sent to candidates",
 * why, that configuring a relay does not send what is already recorded (a queued row is terminal),
 * and the one door: the relay's own level (level 1). With a relay and old queued rows, a quieter
 * line that they stay recorded, and a way to see them. Never a green lie; nothing when there is
 * nothing to say. The words are the plumbing's needs (channelsNight.plumbing.need.*), so the
 * district and the book say the same sentence.
 */
export function ChannelsNightLedgerAlarm({ fact, onConfigure, onShowQueued }: {
  fact: RelayFact;
  onConfigure: (el: HTMLElement) => void;
  onShowQueued: () => void;
}) {
  const tn = useTranslations("channelsNight.plumbing.need");
  const tl = useTranslations("channelsNight.ledger");
  if (!fact) return null;
  const em = (chunks: ReactNode) => <strong>{chunks}</strong>;
  if (fact.kind === "off") {
    return (
      <div className="cn-ledger__alarm" data-tone="bad" role="alert">
        <span className="cn-ledger__alarm-mark" aria-hidden="true"><Mark kind="fail" /></span>
        <div className="cn-ledger__alarm-body">
          <p className="cn-ledger__alarm-title">
            {fact.queued > 0 ? tn.rich("relayOffQueued.title", { count: fact.queued, em }) : tn("relayOff.title")}
          </p>
          <p>
            {fact.queued > 0 ? tn("relayOffQueued.detail") : tn("relayOff.detail")} {tl("relayOffStays")}
          </p>
        </div>
        <Button variant="primary" label={tn("relayOffQueued.cta")} onClick={(e) => onConfigure(e.currentTarget)} />
      </div>
    );
  }
  return (
    <div className="cn-ledger__alarm" data-tone="warn" role="status">
      <span className="cn-ledger__alarm-mark" aria-hidden="true"><Mark kind="wait" /></span>
      <div className="cn-ledger__alarm-body">
        <p className="cn-ledger__alarm-title">{tn.rich("queuedWithRelay.title", { count: fact.queued, em })}</p>
        <p>{tl("queuedStays")}</p>
      </div>
      <Button variant="ghost" label={tn("queuedWithRelay.cta")} onClick={onShowQueued} />
    </div>
  );
}

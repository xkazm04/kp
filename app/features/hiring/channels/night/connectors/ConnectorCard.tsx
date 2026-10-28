"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { SetupCard, SetupResult } from "../setup/SetupBits";
import type { DeckCard } from "./connectorsDeckModel";

/** The calendar's OAuth start (the calendar panel's Connect / Reconnect door). */
const CALENDAR_START_URL = "/api/calendar/google/start";

/** What the last press on this card answered, to say under it. */
export type CardNote = { ok: boolean; text: string };

/**
 * One connector on the deck, as the Night Post's setup card (setup/SetupBits SetupCard: its name,
 * its condition in shape and words, its body): the one fact its health word owes (when it last
 * checked out, the last failure in the probe's own words, why nothing is checked), the calendar's
 * free/busy as read or unknown, and its ONE door. The press is the parent's: this component never
 * reaches the wire, and smtp's door is the sender level, never a probe.
 */
export function ConnectorCard({ card, busy, note, onProbe, onSender }: {
  card: DeckCard;
  busy: boolean;
  note: CardNote | null;
  onProbe: (card: DeckCard) => void;
  onSender: (el: HTMLElement) => void;
}) {
  const t = useTranslations("channelsNight.connectors");
  const tr = useTranslations();
  const rel = useRelativeTime();
  const name = card.provider ? t("name.ats_inbound", { provider: card.provider }) : t(`name.${card.id as "comms_relay" | "smtp" | "ats_webhook" | "calendar"}`);
  const fact =
    card.health === "connected" && card.lastOkAt
      ? t("fact.lastOk", { time: rel(card.lastOkAt) })
      : card.health === "failing" && card.failure
        ? t("fact.failure", { reason: card.failure })
        : card.health === "not_configured"
          ? t(card.group === "delivery" ? "fact.notConfiguredSender" : "fact.notConfiguredBelow")
          : t(`fact.${card.health}`);

  return (
    <SetupCard title={name} condition={card.condition} words={tr(card.label)}>
      <p className="cns-help">{fact}</p>
      {card.busy ? <p className="cns-help">{t(card.busy === "read" ? "busy.read" : "busy.unknown")}</p> : null}
      {card.id === "smtp" ? <p className="cns-help">{t("fact.smtpRule")}</p> : null}
      {card.door ? (
        <div className="cns-row">
          {card.door === "probe" ? (
            <Button label={t("door.probe")} loadingLabel={t("door.probing")} loading={busy} onClick={() => onProbe(card)} />
          ) : card.door === "reconnect" ? (
            // The OAuth start is a top-level navigation (state cookie + 302 to Google), so it is a
            // link wearing the kit button, exactly as the calendar panel's own Connect is.
            <a className="k-btn k-btn--primary" href={CALENDAR_START_URL}>
              {t("door.reconnect")}
            </a>
          ) : (
            <Button label={t("door.sender")} icon="right" onClick={(e) => onSender(e.currentTarget)} />
          )}
        </div>
      ) : null}
      {note ? <SetupResult ok={note.ok}>{note.text}</SetupResult> : null}
    </SetupCard>
  );
}

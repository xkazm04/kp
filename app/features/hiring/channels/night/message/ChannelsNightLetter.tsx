"use client";

import { useTranslations } from "next-intl";
import { ABSENT, Button, KeyValueGrid, Mark, Note } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { commsVerdict, isUnaddressable } from "@/app/_lib/comms-view";
import { resendDoorOf } from "@/app/_lib/comms-resend-outcome";
import { labelize } from "@/app/_lib/format";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { commsStatusLabels, displayRecipient, type Message, type ReceiptLabels, type RefInfo } from "../../channelsCommsHelpers";
import { VERDICT_MARK, humanKind, ledgerName, ledgerRole } from "../ledger/channelsNightLedgerModel";
import { CorrectAddressDoor, RetryDoor } from "./ChannelsNightResendDoor";
import { ChannelsNightMessageTimeline } from "./ChannelsNightMessageTimeline";
import { deliveryTimeline, messageNote } from "./channelsNightMessageModel";
import "./message.css";

/**
 * One message as a letter (level 3): its verdict in shape and words, the record (to whom, the
 * role, the type, when it was recorded, the reference, the channel), the one honest note under the
 * verdict, what a person can do about it, the delivery timeline from the row's own fields, and the
 * body as it was stored (never composed: a letter without a body says so).
 *
 * "What you can do" offers only what exists: the resend door resendDoorOf answers (a dead letter
 * re-dispatched, a bounce to a corrected address), or, for mail queued with no relay, the relay's
 * own level, with the truth that configuring it does not send this letter. The prototype's
 * "hand the queue to the relay", "resend a copy" of a sent letter and "recover" of an unmatched
 * receipt have no API behind them and are not offered. An unaddressable recipient is the caution
 * note from the shared predicate (isUnaddressable), never a read of the raw bit: the drawer and
 * this letter tell one truth (drawerCommsTruth.test.ts).
 */
export function ChannelsNightLetter({ message: m, refs, receipt, relayConfigured, onResent, onConfigureRelay }: {
  message: Message;
  refs: Record<string, RefInfo>;
  receipt: ReceiptLabels;
  relayConfigured: boolean;
  onResent: () => void;
  onConfigureRelay: (el: HTMLElement) => void;
}) {
  const t = useTranslations("channels.comms");
  const tk = useTranslations("channels.kit");
  const tm = useTranslations("channelsNight.message");
  const tn = useTranslations("channelsNight.plumbing.need.relayOffQueued");
  const { dateTime } = useDateFormat();
  const relay = useDeliveryCapability();
  const labels = commsStatusLabels(t);
  const verdict = commsVerdict(m);
  const door = resendDoorOf({ verdict, channel: m.channel });
  const note = messageNote(verdict, relayConfigured);
  const name = ledgerName(m, refs, receipt);
  const recipient = displayRecipient(m, receipt);
  const configure = verdict === "queued" && !relayConfigured;

  const noteText =
    note?.key === "queuedNoRelay" ? tm.rich("note.queuedNoRelay", { name, b: (c) => <b>{c}</b> })
    : note?.key === "queuedLater" ? tm("note.queuedLater")
    : note?.key === "failed" ? (m.failureDetail ? t("failureDetail", { detail: m.failureDetail }) : t("failureDetailUnknown"))
    : note?.key === "bounced" ? t("bouncedAt", { time: dateTime(m.bouncedAt), detail: m.bounceDetail ?? ABSENT })
    : note?.key === "orphaned" ? t("orphanHint")
    : null;

  return (
    <article className="cn-msg" data-v={verdict}>
      <p className="cn-msg__verdict" data-v={verdict}>
        <b>
          <span aria-hidden="true"><Mark kind={VERDICT_MARK[verdict]} /></span>
          {labels[verdict]}
        </b>
        <span>{tm(`hint.${verdict}`)}</span>
      </p>
      <KeyValueGrid
        cols={3}
        items={[
          { label: tm("to"), value: recipient ? <>{recipient}{name !== recipient ? <small className="cn-msg__who">{name}</small> : null}</> : null },
          { label: t("colRole"), value: ledgerRole(m, refs), absent: tk("noEntry") },
          { label: t("colType"), value: m.kind ? humanKind(m.kind) : null },
          { label: t("colRecorded"), value: dateTime(m.createdAt) },
          { label: tm("reference"), value: m.ref ? <code className="k-code">{m.ref}</code> : null },
          { label: t("colChannel"), value: m.channel ? labelize(m.channel) : null },
        ]}
      />
      {note && noteText ? <Note tone={note.tone}>{noteText}</Note> : null}
      {isUnaddressable(m, relay) ? <Note tone="caution">{t("noAddressHint")}</Note> : null}
      <div className="cn-msg__grid" data-acts={door || configure ? "1" : undefined}>
        {door || configure ? (
          <section className="cn-msg__part cn-msg__acts">
            <h3 className="cn-msg__h">{tm("act.title")}</h3>
            {door === "correctAddress" ? (
              <CorrectAddressDoor id={m.id} defaultRecipient={m.recipient} onResent={onResent} />
            ) : door === "retry" ? (
              <RetryDoor id={m.id} onResent={onResent} />
            ) : (
              <div className="cn-door">
                <div className="cn-door__row">
                  <Button variant="primary" icon="right" label={tn("cta")} onClick={(e) => onConfigureRelay(e.currentTarget)} data-level-key="door" />
                </div>
                <p className="cn-door__help">{tm("act.configureHelp")}</p>
              </div>
            )}
          </section>
        ) : null}
        <ChannelsNightMessageTimeline steps={deliveryTimeline(m, relayConfigured)} />
      </div>
      <section className="cn-msg__part">
        <h3 className="cn-msg__h">{tk("body")}</h3>
        {m.body ? <pre className="k-body cn-msg__body">{m.body}</pre> : <p className="cn-msg__sub">{tk("noBody")}</p>}
      </section>
    </article>
  );
}

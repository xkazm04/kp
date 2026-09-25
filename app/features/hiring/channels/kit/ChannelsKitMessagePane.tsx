"use client";

import { useLocale, useTranslations } from "next-intl";
import { KeyValueGrid, Mark, Section } from "@/app/_components/kit";
import { commsVerdict } from "@/app/_lib/comms-view";
import { labelize } from "@/app/_lib/format";
import { resendDoorOf } from "@/app/_lib/comms-resend-outcome";
import { ResendButton } from "@/app/features/tools/devcases/ResendButton";
import { BouncedResend } from "../ChannelsCommsBouncedResend";
import { commsStatusLabels, displayRecipient, displaySubject, formatRecordedAt, type Message, type ReceiptLabels, type RefInfo } from "../channelsCommsHelpers";
import { humanKind, ledgerName, ledgerRole, recordedShort, VERDICT_MARK } from "./channelsKitModel";

/**
 * One message as a document: subject, recipient and channel, the verdict with its reason,
 * the resend door the current modal offers (ResendButton for a failed send, BouncedResend
 * for a bounced address: the product's own actions), the record, the body.
 */
export function ChannelsKitMessagePane({ message: m, refs, receipt, onResent }: {
  message: Message;
  refs: Record<string, RefInfo>;
  receipt: ReceiptLabels;
  onResent: () => void;
}) {
  const t = useTranslations("channels.comms");
  const tk = useTranslations("channels.kit");
  const locale = useLocale();
  const labels = commsStatusLabels(t);
  const verdict = commsVerdict(m);
  const door = resendDoorOf({ verdict, channel: m.channel });
  const reason =
    verdict === "failed"
      ? m.failureDetail ? t("failureDetail", { detail: m.failureDetail }) : t("failureDetailUnknown")
      : verdict === "bounced"
        ? t("bouncedAt", { time: m.bouncedAt ? formatRecordedAt(m.bouncedAt, locale) : "—", detail: m.bounceDetail ?? "—" })
        : verdict === "orphaned"
          ? t("orphanHint")
          : verdict === "recovered"
            ? t("resendRecovered")
            : m.channel ? t("via", { channel: labelize(m.channel) }) : null;
  const recipient = displayRecipient(m, receipt);

  return (
    <>
      <h3>{displaySubject(m, receipt) ?? ledgerName(m, refs, receipt)}</h3>
      <p className="k-margin__sub">
        {recipient ? tk("to", { recipient }) : null}
        {recipient && m.channel ? " · " : null}
        {m.channel ? t("via", { channel: labelize(m.channel) }) : null}
      </p>
      <div className="k-verdict">
        <Mark kind={VERDICT_MARK[verdict]} />
        <div>
          <b>{labels[verdict]}</b>
          {reason ? <> {"·"} {reason}</> : null}
        </div>
      </div>
      {door === "correctAddress" ? (
        <BouncedResend id={m.id} defaultRecipient={m.recipient} onResent={onResent} />
      ) : door === "retry" ? (
        <ResendButton id={m.id} onResent={onResent} />
      ) : null}
      <Section title={tk("record")}>
        <KeyValueGrid
          items={[
            { label: t("colName"), value: ledgerName(m, refs, receipt) },
            { label: t("colRole"), value: ledgerRole(m, refs), absent: tk("noEntry") },
            { label: t("colType"), value: m.kind ? humanKind(m.kind) : null },
            { label: t("colRecorded"), value: recordedShort(m.createdAt, locale) },
            { label: tk("deliverable"), value: m.deliverable === undefined ? null : m.deliverable ? tk("deliverableYes") : tk("deliverableNo") },
            { label: t("colChannel"), value: m.channel ? labelize(m.channel) : null },
          ]}
        />
      </Section>
      <Section title={tk("body")}>
        {m.body ? <pre className="k-body">{m.body}</pre> : <p className="k-margin__sub">{tk("noBody")}</p>}
      </Section>
    </>
  );
}

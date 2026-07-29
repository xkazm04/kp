"use client";

// The message-detail modal opened from a Comms ledger row: status/kind/channel
// header, the orphaned-receipt and bounced-at notes, WHY a dead letter failed,
// the body, and the resend action (bounced or dead-letter). Split out of
// ChannelsCommsTable.tsx to keep the table file under the 200-line cap.

import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { Modal } from "@/app/_components/Modal";
import { labelize } from "@/app/_lib/format";
import { ResendButton } from "@/app/features/tools/devcases/OutboxSection";
import { formatRecordedAt, statusTone, type Message, type StatusLabels } from "./channelsCommsHelpers";
import { BouncedResend } from "./ChannelsCommsBouncedResend";

export function ChannelsCommsMessageModal({
  message,
  name,
  roleLabel,
  statusLabels,
  onClose,
  onResent,
}: {
  message: Message;
  name: string;
  roleLabel: string | null;
  statusLabels: StatusLabels;
  onClose: () => void;
  onResent: () => void;
}) {
  const t = useTranslations("channels.comms");
  const locale = useLocale();
  return (
    <Modal title={name} subtitle={roleLabel ?? message.recipient ?? undefined} onClose={onClose} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge {...statusTone(message, statusLabels)} />
          {message.kind ? <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold uppercase text-steel">{labelize(message.kind)}</span> : null}
          {message.channel ? <span className="text-xs text-steel">{t("via", { channel: labelize(message.channel) })}</span> : null}
          <span className="ml-auto text-xs text-steel">{formatRecordedAt(message.createdAt, locale)}</span>
        </div>
        {message.orphaned ? (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
            {t("orphanHint")}
          </p>
        ) : null}
        {message.bounced ? (
          <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-800">
            <AlertTriangle size={12} aria-hidden />
            {t("bouncedAt", { time: message.bouncedAt ? new Date(message.bouncedAt).toLocaleString() : "—", detail: message.bounceDetail ?? "—" })}
          </p>
        ) : null}
        {message.status === "failed" && !message.recovered && !message.bounced ? (
          <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-800">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
            {message.failureDetail ? t("failureDetail", { detail: message.failureDetail }) : t("failureDetailUnknown")}
          </p>
        ) : null}
        {message.subject ? <p className="font-semibold text-ink">{message.subject}</p> : null}
        {message.body ? (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-stone-200 bg-paper/50 p-3 font-sans text-sm leading-5 text-steel">
            {message.body}
          </pre>
        ) : (
          <p className="text-sm italic text-steel">{t("empty")}</p>
        )}
        {message.bounced ? (
          <BouncedResend id={message.id} defaultRecipient={message.recipient} onResent={onResent} />
        ) : message.status === "failed" && !message.recovered ? (
          <ResendButton id={message.id} onResent={onResent} />
        ) : null}
      </div>
    </Modal>
  );
}

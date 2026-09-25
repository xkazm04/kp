"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, DataTable, Mark, Note, Section, formatCount, type Column } from "@/app/_components/kit";
import { ConfirmDialog } from "@/app/_components/ConfirmDialog";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { useCommsCapability } from "@/app/features/shell/useDeliveryCapability";
import { useReceivers, isReceiverLive } from "../useChannelsReceivers";
import { AddReceiverModal } from "../ChannelsAddReceiverModal";
import { useCopyState } from "../useCopyState";
import type { ChannelJob } from "../useChannelsData";
import { receiverRow, type ChannelsSelection } from "./channelsKitModel";

/**
 * Email intake / Ad forms on the kit: one Receivers section whose rows are the section's
 * webhooks (health mark, role + first lead, endpoint, language, accepted of received, last
 * received). Add, copy and remove are the current tab's own actions (AddReceiverModal,
 * useReceivers.revoke behind a confirm); the setup guide and pull source open in the pane.
 */
export function ChannelsKitReceivers({ section, channel, receivers, webhooks, jobs, truncated, reload, sel, setSel }: {
  section: "email" | "ads";
  channel: string;
  receivers: ChannelWebhookRecord[] | null;
  webhooks: ChannelWebhookRecord[] | null;
  jobs: ChannelJob[] | null;
  truncated: boolean;
  reload: () => void;
  sel: ChannelsSelection | null;
  setSel: (s: ChannelsSelection | null) => void;
}) {
  const t = useTranslations("channels");
  const tk = useTranslations("channels.kit");
  const tu = useTranslations("kit");
  const locale = useLocale();
  const rel = useRelativeTime();
  const { emailInboundDomain } = useCommsCapability();
  const { revoke, revoking, revokeFailed } = useReceivers({ channel, webhooks, reload });
  const { copy } = useCopyState();
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<ChannelWebhookRecord | null>(null);
  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const endpointOf = (w: ChannelWebhookRecord) =>
    section === "email" && emailInboundDomain ? `${w.token}@${emailInboundDomain}` : `${base}/api/channels/inbound/${w.token}`;
  const endpointLabel = section === "email" ? (emailInboundDomain ? t("email.endpointWired") : t("email.endpointUnwired")) : t("ads.endpoint");

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "role", label: t("receivers.role"), track: "name", primary: true },
    { id: "endpoint", label: endpointLabel, track: "meta", quiet: true },
    { id: "lang", label: t("receivers.lang"), track: "meta+1" },
    { id: "accepted", label: tk("acceptedOfReceived"), track: "fig", numeric: true, tip: t("receivers.acceptedHint") },
    { id: "last", label: tk("lastReceived"), track: "time", numeric: true },
    { id: "act", label: "", track: "act" },
  ];

  return (
    <>
      {section === "email" && !emailInboundDomain ? (
        <Note tone="caution">
          <strong>{t("email.notWiredTitle")}</strong> {t("email.notWiredHowTo")}
        </Note>
      ) : null}
      {truncated ? <Note tone="caution">{t("receiversTruncated")}</Note> : null}
      {revokeFailed ? <Note tone="critical">{revokeFailed}</Note> : null}
      <Section
        title={t("stats.receivers")}
        count={receivers ? formatCount(receivers.length, locale) : undefined}
        actions={<Button label={section === "email" ? t("email.add") : t("ads.add")} icon="plus" size="sm" onClick={() => setAddOpen(true)} />}
      >
        <DataTable
          label={t("stats.receivers")}
          rows={receivers ?? []}
          columns={columns}
          visibleRows={8}
          metaSplit="minmax(0,1fr) 80px"
          rowKey={(w) => w.token}
          rowState={(w) => (receiverRow(w).needs ? ["needs"] : [])}
          selectedKey={sel?.kind === "hook" ? sel.key : null}
          onSelect={(token) => setSel({ kind: "hook", key: token })}
          state={receivers === null ? "loading" : "ready"}
          emptyText={section === "email" ? (emailInboundDomain ? t("email.emptyWired") : t("email.emptyUnwired")) : t("ads.empty")}
          cells={(w) => {
            const r = receiverRow(w);
            const label = t(r.key);
            return [
              <Mark key="m" kind={r.mark} tip={r.detail ? `${label}: ${r.detail}` : label} />,
              <>
                {w.jobTitle ?? w.jobId}
                <small>{w.firstAcceptedAt ? tk("firstLeadAgo", { time: rel(w.firstAcceptedAt) }) : isReceiverLive(w) ? tk("noLeadYet") : tk("neverReached")}</small>
              </>,
              <code key="e" className="k-code">{endpointOf(w)}</code>,
              (w.lang ?? "").toUpperCase(),
              w.receivedCount ? (
                <>
                  {formatCount(w.acceptedCount, locale)}
                  <span className="k-fig__of"> {tu("of", { total: w.receivedCount })}</span>
                </>
              ) : (
                <span className="k-absent">{"—"}</span>
              ),
              w.lastReceivedAt ? rel(w.lastReceivedAt) : "—",
              <span key="a" style={{ display: "contents" }} onClick={(e) => e.stopPropagation()}>
                <Button label={t("receivers.copyEndpoint")} icon="copy" iconOnly size="sm" variant="ghost" onClick={() => copy(endpointOf(w))} />
                <Button label={t("receivers.removeAria", { role: w.jobTitle ?? w.jobId })} icon="trash" iconOnly size="sm" variant="ghost" disabled={revoking === w.token} onClick={() => setConfirm(w)} />
              </span>,
            ];
          }}
        />
      </Section>
      {addOpen ? (
        <AddReceiverModal
          title={section === "email" ? t("email.title") : t("ads.title")}
          channel={channel}
          jobs={jobs}
          onClose={() => setAddOpen(false)}
          onCreated={(token) => {
            reload();
            if (token) setSel({ kind: "hook", key: token });
          }}
        />
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title={t("receivers.confirmTitle")}
          confirmLabel={t("receivers.confirm")}
          cancelLabel={t("receivers.cancel")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            void revoke(confirm.token);
            if (sel?.key === confirm.token) setSel(null);
            setConfirm(null);
          }}
        >
          <p>{t.rich("receivers.confirmBody", { role: confirm.jobTitle ?? confirm.jobId, endpoint: endpointLabel, b: (c) => <b>{c}</b> })}</p>
          {isReceiverLive(confirm) ? <p>{t("receivers.confirmLive", { count: confirm.receivedCount })}</p> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

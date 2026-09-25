"use client";

import { useTranslations } from "next-intl";
import { ReadingPane, Section } from "@/app/_components/kit";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { RelayConfigCard } from "../ChannelsRelayConfigCard";
import { EdgeConfigCard } from "../ChannelsEdgeCard";
import type { ChannelSectionId } from "../channelsSections";
import type { Message, ReceiptLabels, RefInfo } from "../channelsCommsHelpers";
import { ledgerName, type ChannelsSelection } from "./channelsKitModel";
import { ChannelsKitMessagePane } from "./ChannelsKitMessagePane";
import { ChannelsKitReceiverPane } from "./ChannelsKitReceiverPane";

/**
 * The Channels kit view's reading pane: a message (verdict, record, body, the resend door),
 * a receiver (health, setup guide, pull source) or one of the two delivery editors. It
 * exists only while something is selected; a selection whose row left the list (a filter,
 * a revoke) closes it rather than showing a stale document.
 */
export function ChannelsKitPane({ sel, section, ledger, refs, receipt, receivers, stepIndex, stepTotal, onStep, onClose, onResent, reload }: {
  sel: ChannelsSelection;
  section: ChannelSectionId;
  ledger: Message[];
  refs: Record<string, RefInfo>;
  receipt: ReceiptLabels;
  receivers: ChannelWebhookRecord[];
  stepIndex: number;
  stepTotal: number;
  onStep: (d: 1 | -1) => void;
  onClose: () => void;
  onResent: () => void;
  reload: () => void;
}) {
  const t = useTranslations("channels");
  const tk = useTranslations("channels.kit");
  const sectionLabel = t(`sections.${section}.label`);
  const common = { index: stepIndex, total: stepTotal, onStep, onClose };

  if (sel.kind === "relay" || sel.kind === "edge") {
    const title = sel.kind === "relay" ? t("relay.title") : t("edge.title");
    return (
      <ReadingPane trail={[sectionLabel, tk("delivery"), title]} itemKey={sel.kind} {...common} index={-1} total={0}>
        <h3>{title}</h3>
        <Section title={tk("setup")}>{sel.kind === "relay" ? <RelayConfigCard /> : <EdgeConfigCard />}</Section>
      </ReadingPane>
    );
  }
  if (sel.kind === "msg") {
    const m = ledger.find((x) => x.id === sel.key);
    if (!m) return null;
    return (
      <ReadingPane trail={[sectionLabel, t("ledger"), ledgerName(m, refs, receipt)]} itemKey={m.id} {...common}>
        <ChannelsKitMessagePane message={m} refs={refs} receipt={receipt} onResent={onResent} />
      </ReadingPane>
    );
  }
  const w = receivers.find((x) => x.token === sel.key);
  if (!w) return null;
  return (
    <ReadingPane trail={[sectionLabel, t("stats.receivers"), w.jobTitle ?? w.jobId]} itemKey={w.token} {...common}>
      <ChannelsKitReceiverPane receiver={w} section={section === "email" ? "email" : "ads"} reload={reload} />
    </ReadingPane>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { KitSurface, stepKey } from "@/app/_components/kit";
import { useUrlInboxState } from "@/app/features/shell/nav/useUrlInboxState";
import { CHANNEL_SECTIONS, isChannelSectionId, resolveChannelSection, type ChannelSectionId } from "../channelsSections";
import { useChannelData } from "../useChannelsData";
import { useCommsFeed } from "../useCommsFeed";
import { commsReceiptLabels, displayRecipient, displaySubject } from "../channelsCommsHelpers";
import { filterLedger, ledgerName, receiversFor, type ChannelsSelection, type VerdictFilter } from "./channelsKitModel";
import { ChannelsKitHead } from "./ChannelsKitHead";
import { ChannelsKitComms } from "./ChannelsKitComms";
import { ChannelsKitReceivers } from "./ChannelsKitReceivers";
import { ChannelsKitCareers } from "./ChannelsKitCareers";
import { ChannelsKitPane } from "./ChannelsKitPane";

/**
 * Hiring > Channels, composed from the composition kit (Gate K2; rendered only behind the
 * dev-only `?kit=1` switch, see ChannelsTab). Same data as the current tab, read through the
 * same hooks: useChannelData (receivers, open roles, the attention count), useCommsFeed (the
 * ledger), the `sec` inbox param. Layout is the One Measure winner's Channels surface: a page
 * head with the section's figures, a toolbar (sections, verdict chips, search), the section's
 * body, and a reading pane that exists only while a row is selected.
 */
export default function ChannelsKitView() {
  const tc = useTranslations("channels.comms");
  const search = useSearchParams();
  const data = useChannelData();
  const feed = useCommsFeed();
  const [section, setSectionRaw] = useUrlInboxState<ChannelSectionId>(
    "sec",
    (raw) => (isChannelSectionId(raw) ? raw : null),
    resolveChannelSection(search.get("sec")),
  );
  const [sel, setSel] = useState<ChannelsSelection | null>(null);
  const [verdict, setVerdict] = useState<VerdictFilter>(null);
  const [q, setQ] = useState("");
  const setSection = (next: ChannelSectionId) => {
    setSel(null);
    setVerdict(null);
    setSectionRaw(next);
  };

  const active = CHANNEL_SECTIONS.find((s) => s.id === section)!;
  const receipt = useMemo(() => commsReceiptLabels(tc), [tc]);
  const refs = feed.feed.refs;
  const messages = feed.feed.messages;
  const ledger = useMemo(
    () =>
      messages === null
        ? null
        : filterLedger(messages, {
            verdict,
            q,
            nameOf: (m) => ledgerName(m, refs, receipt),
            subjectOf: (m) => displaySubject(m, receipt),
            recipientOf: (m) => displayRecipient(m, receipt),
          }),
    [messages, verdict, q, refs, receipt],
  );
  const receivers = receiversFor(data.webhooks, active.channel);

  // j / k walk the list the section shows; the careers links have no document to open.
  const stepList = section === "comms" ? (ledger ?? []).map((m) => m.id) : (receivers ?? []).map((w) => w.token);
  const stepKind: ChannelsSelection["kind"] = section === "comms" ? "msg" : "hook";
  const onStep = (d: 1 | -1) => {
    if (section === "careers") return;
    const current = sel && sel.kind === stepKind ? sel.key : null;
    const next = stepKey(stepList, current, d);
    if (next) setSel({ kind: stepKind, key: next });
  };

  // A selection whose row left the list (a filter, a revoke) opens nothing: no stale document.
  const resolved =
    sel !== null &&
    (sel.kind === "relay" || sel.kind === "edge" || (sel.kind === "msg" ? (ledger ?? []).some((m) => m.id === sel.key) : (receivers ?? []).some((w) => w.token === sel.key)));
  const pane = sel && resolved ? (
    <ChannelsKitPane
      sel={sel}
      section={section}
      ledger={ledger ?? []}
      refs={refs}
      receipt={receipt}
      receivers={receivers ?? []}
      stepIndex={stepList.indexOf(sel.key)}
      stepTotal={stepList.length}
      onStep={onStep}
      onClose={() => setSel(null)}
      onResent={() => feed.load()}
      reload={data.reload}
    />
  ) : null;

  return (
    <KitSurface density="compact" pane={pane} onStep={onStep} onClose={() => setSel(null)}>
      <div data-sim="channels" aria-busy={data.webhooks === null || data.jobs === null}>
        <ChannelsKitHead
          section={section}
          setSection={setSection}
          data={data}
          messages={messages}
          olderExist={feed.feed.hasMore || feed.feed.truncated}
          verdict={verdict}
          setVerdict={setVerdict}
          q={q}
          setQ={setQ}
        />
        {section === "comms" ? (
          <ChannelsKitComms
            feed={feed}
            ledger={ledger}
            refs={refs}
            receipt={receipt}
            verdict={verdict}
            setVerdict={setVerdict}
            filtered={Boolean(verdict || q.trim())}
            sel={sel}
            setSel={setSel}
          />
        ) : section === "careers" ? (
          <ChannelsKitCareers jobs={data.jobs} />
        ) : (
          <ChannelsKitReceivers
            section={section}
            channel={active.channel ?? ""}
            receivers={receivers}
            webhooks={data.webhooks}
            jobs={data.jobs}
            truncated={data.webhooksTruncated}
            reload={data.reload}
            sel={sel}
            setSel={setSel}
          />
        )}
      </div>
    </KitSurface>
  );
}

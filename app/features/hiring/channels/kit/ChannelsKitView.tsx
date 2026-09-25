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
import { filterLedger, ledgerName, ledgerRole, NO_FACETS, receiversFor, type ChannelsSelection, type LedgerFacets, type VerdictFilter } from "./channelsKitModel";
import { ChannelsKitHead } from "./ChannelsKitHead";
import { ChannelsKitComms } from "./ChannelsKitComms";
import { ChannelsKitReceivers } from "./ChannelsKitReceivers";
import { ChannelsKitCareers } from "./ChannelsKitCareers";
import { ChannelsKitPane } from "./ChannelsKitPane";
import { ChannelsKitLedgerFacets } from "./ChannelsKitLedgerFacets";

/**
 * Hiring > Channels, composed from the composition kit (promoted at Gate K2; ChannelsTab renders
 * it). Its data comes through the tab's hooks: useChannelData (receivers, open roles, the
 * attention count), useCommsFeed (the ledger), the `sec` inbox param. Layout is the One Measure winner's Channels surface: a page
 * head with the section's figures, a toolbar (sections, verdict chips, search), the section's
 * body, and a reading pane that exists only while a row is selected.
 *
 * On Email intake / Ad forms the first receiver opens by itself (the old view showed the first
 * row's setup guide under the table): only while the section has receivers and nothing is
 * selected, and a pane closed by hand stays closed until the section changes.
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
  const [facets, setFacets] = useState<LedgerFacets>(NO_FACETS);
  const [autoOff, setAutoOff] = useState(false);
  const setSection = (next: ChannelSectionId) => {
    setSel(null);
    setVerdict(null);
    setFacets(NO_FACETS);
    setAutoOff(false);
    setSectionRaw(next);
  };
  const close = () => {
    setSel(null);
    setAutoOff(true);
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
            facets,
            roleOf: (m) => ledgerRole(m, refs),
          }),
    [messages, verdict, q, facets, refs, receipt],
  );
  const receivers = receiversFor(data.webhooks, active.channel);
  const auto: ChannelsSelection | null =
    !autoOff && sel === null && active.channel && receivers && receivers.length > 0 ? { kind: "hook", key: receivers[0].token } : null;
  const current = sel ?? auto;

  // j / k walk the list the section shows; the careers links have no document to open.
  const stepList = section === "comms" ? (ledger ?? []).map((m) => m.id) : (receivers ?? []).map((w) => w.token);
  const stepKind: ChannelsSelection["kind"] = section === "comms" ? "msg" : "hook";
  const onStep = (d: 1 | -1) => {
    if (section === "careers") return;
    const at = current && current.kind === stepKind ? current.key : null;
    const next = stepKey(stepList, at, d);
    if (next) setSel({ kind: stepKind, key: next });
  };

  // A selection whose row left the list (a filter, a revoke) opens nothing: no stale document.
  const resolved =
    current !== null &&
    (current.kind === "relay" ||
      current.kind === "edge" ||
      (current.kind === "msg" ? (ledger ?? []).some((m) => m.id === current.key) : (receivers ?? []).some((w) => w.token === current.key)));
  const pane = current && resolved ? (
    <ChannelsKitPane
      sel={current}
      section={section}
      ledger={ledger ?? []}
      refs={refs}
      receipt={receipt}
      receivers={receivers ?? []}
      stepIndex={stepList.indexOf(current.key)}
      stepTotal={stepList.length}
      onStep={onStep}
      onClose={close}
      onResent={() => feed.load()}
      reload={data.reload}
    />
  ) : null;

  return (
    <KitSurface density="compact" pane={pane} onStep={onStep} onClose={close}>
      {/* aria-busy only until every source settled once; a failed load is not loading, it is
          broken, and the head's alert is what a screen reader should hear instead. */}
      <div data-sim="channels" aria-busy={(data.webhooks === null || data.jobs === null || data.accepted === null) && !data.loadFailed}>
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
          facetFilters={
            messages ? <ChannelsKitLedgerFacets messages={messages} roleOf={(m) => ledgerRole(m, refs)} facets={facets} setFacets={setFacets} /> : null
          }
        />
        {section === "comms" ? (
          <ChannelsKitComms
            feed={feed}
            ledger={ledger}
            refs={refs}
            receipt={receipt}
            verdict={verdict}
            setVerdict={setVerdict}
            filtered={Boolean(verdict || q.trim() || facets.role || facets.channel || facets.kind)}
            sel={current}
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
            sel={current}
            setSel={setSel}
          />
        )}
      </div>
    </KitSurface>
  );
}

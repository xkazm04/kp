"use client";

import { useLocale, useTranslations } from "next-intl";
import { ABSENT, Button, DataTable, Mark, type Column } from "@/app/_components/kit";
import { commsVerdict, isUnaddressable } from "@/app/_lib/comms-view";
import { resendDoorOf } from "@/app/_lib/comms-resend-outcome";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { commsStatusLabels, displaySubject, isActionable, type Message, type ReceiptLabels, type RefInfo } from "../../channelsCommsHelpers";
import type { useCommsFeed } from "../../useCommsFeed";
import { VERDICT_MARK, humanKind, ledgerName, ledgerRole, recordedShort } from "./channelsNightLedgerModel";

/** Rows the viewport shows at once: the table never grows with the ledger (46 rows or 460). */
const VISIBLE_ROWS = 9;

/**
 * The post book's rows: ONE windowed kit DataTable (only the rows in view plus the overscan exist
 * in the DOM), dead letters first, then newest first. A row names its verdict in shape (the mark,
 * whose tip is the reason: the failure detail, the bounce, the unmatched hint, "nothing leaves this
 * machine") AND in words (the verdict column). A recipient no real relay can address wears the
 * caution mark from the shared predicate (isUnaddressable) and the drawer's own words
 * (channels.comms.noAddressHint): drawerCommsTruth.test.ts pins that the two surfaces agree. The
 * pager under the last row carries "Load older" while a cursor reaches more, and the honest
 * "beyond this view" once none does. A row opens its letter (level 3); its act button is the same
 * door for the keyboard (a resend glyph when the letter offers one).
 */
export function ChannelsNightLedgerTable({ feed, rows, refs, receipt, filtered, selectedKey, resetKey, onOpen }: {
  feed: ReturnType<typeof useCommsFeed>;
  rows: Message[] | null;
  refs: Record<string, RefInfo>;
  receipt: ReceiptLabels;
  filtered: boolean;
  selectedKey: string | null;
  resetKey: string;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("channels");
  const tc = useTranslations("channels.comms");
  const tk = useTranslations("channels.kit");
  const tl = useTranslations("channelsNight.ledger");
  const locale = useLocale();
  const relay = useDeliveryCapability();
  const labels = commsStatusLabels(tc);

  const verdictTip = (m: Message) => {
    const v = commsVerdict(m);
    if (v === "failed") return `${labels.failed}: ${m.failureDetail ? tc("failureDetail", { detail: m.failureDetail }) : tc("failureDetailUnknown")}`;
    if (v === "bounced") return `${labels.bounced}: ${m.bounceDetail ?? ABSENT}`;
    if (v === "orphaned") return `${labels.orphaned}. ${tc("orphanHint")}`;
    if (v === "queued" && !feed.relayConfigured) return `${labels.queued}. ${tk("queuedTip")}`;
    return labels[v];
  };

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "name", label: `${tc("colName")} · ${tc("colRole")}`, track: "name", primary: true },
    { id: "subject", label: tk("colSubject"), track: "meta", quiet: true },
    { id: "type", label: tc("colType"), track: "meta+1" },
    { id: "verdict", label: tl("colVerdict"), track: "fig" },
    { id: "recorded", label: tc("colRecorded"), track: "time", numeric: true, tip: tc("recordedHint") },
    { id: "act", label: "", track: "act" },
  ];
  const messages = feed.feed.messages;
  // A failed read with rows on screen keeps them (the caller says they are stale); only a
  // ledger that never loaded is an error state.
  const state = messages === null ? (feed.error ? "error" : "loading") : "ready";

  return (
    <DataTable
      label={t("ledger")}
      rows={rows ?? []}
      columns={columns}
      visibleRows={VISIBLE_ROWS}
      metaSplit="minmax(0,1fr) 168px"
      rowKey={(m) => m.id}
      rowState={(m) => (isActionable(m) ? ["needs"] : [])}
      selectedKey={selectedKey}
      onSelect={onOpen}
      resetKey={resetKey}
      state={state}
      loadingText={tc("loading")}
      errorText={tc("loadFailed")}
      onRetry={() => feed.load()}
      emptyText={filtered ? tk("noMatch") : tc("empty")}
      cells={(m) => {
        const v = commsVerdict(m);
        const door = resendDoorOf({ verdict: v, channel: m.channel });
        const role = ledgerRole(m, refs);
        const subject = displaySubject(m, receipt);
        return [
          <Mark key="m" kind={VERDICT_MARK[v]} tip={verdictTip(m)} />,
          <>
            {ledgerName(m, refs, receipt)}
            {isUnaddressable(m, relay) ? <> <Mark kind="caution" tip={tc("noAddressHint")} /></> : null}
            <small>
              {/* on the narrowest sheet the verdict's column folds: its word leads this line there */}
              <span className="cn-ledger__narrow">{labels[v]} · </span>
              {role ?? <span className="k-absent">{ABSENT}</span>}
              {/* the subject's column folds on a narrow sheet: it rides the role line there */}
              {subject ? <span className="cn-ledger__folded"> · {subject}</span> : null}
            </small>
          </>,
          subject ?? "",
          m.kind ? humanKind(m.kind) : "",
          <span key="v" className="cn-ledger__v" data-v={v}>{labels[v]}</span>,
          recordedShort(m.createdAt, locale),
          <Button
            key="a"
            label={door ? tc("resend") : tk("openMessage")}
            icon={door ? "resend" : "right"}
            iconOnly
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(m.id);
            }}
          />,
        ];
      }}
      pagerExtra={
        feed.feed.hasMore ? (
          <Button label={tc("loadOlder")} loadingLabel={tc("loadingOlder")} loading={feed.loadingOlder} size="sm" variant="ghost" onClick={feed.loadOlder} />
        ) : feed.feed.truncated ? (
          <span>{tc("beyondWindow")}</span>
        ) : null
      }
    />
  );
}

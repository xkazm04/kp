"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button, ChipButton, DataTable, Mark, Note, Section, type Column } from "@/app/_components/kit";
import { commsVerdict, isUnaddressable } from "@/app/_lib/comms-view";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { labelize } from "@/app/_lib/format";
import { resendDoorOf } from "@/app/_lib/comms-resend-outcome";
import { commsStatusLabels, displaySubject, isActionable, type Message, type ReceiptLabels, type RefInfo } from "../channelsCommsHelpers";
import type { useCommsFeed } from "../useCommsFeed";
import { deadCount, humanKind, ledgerName, ledgerRole, recordedShort, VERDICT_MARK, type ChannelsSelection, type VerdictFilter } from "./channelsKitModel";
import { ChannelsKitDelivery } from "./ChannelsKitDelivery";

/**
 * Communications on the kit: the Delivery block, then the ledger as ONE windowed DataTable
 * (dead letters first, newest first, 11 rows tall), its pager carrying "load older" while a
 * cursor reaches more and the honest "beyond this view" once none does.
 *
 * A row whose recipient no real relay can address wears a caution mark beside the name, from the
 * shared isUnaddressable predicate (comms-view.ts) and the drawer's own wording
 * (channels.comms.noAddressHint), so the ledger and the candidate drawer cannot disagree about the
 * same message (drawerCommsTruth.test.ts pins both). A KNOWN-false relay is said in full, as an
 * alert above the rows: nothing on this ledger reaches a candidate.
 */
export function ChannelsKitComms({ feed, ledger, refs, receipt, verdict, setVerdict, filtered, sel, setSel }: {
  feed: ReturnType<typeof useCommsFeed>;
  ledger: Message[] | null;
  refs: Record<string, RefInfo>;
  receipt: ReceiptLabels;
  verdict: VerdictFilter;
  setVerdict: (v: VerdictFilter) => void;
  filtered: boolean;
  sel: ChannelsSelection | null;
  setSel: (s: ChannelsSelection | null) => void;
}) {
  const t = useTranslations("channels");
  const tc = useTranslations("channels.comms");
  const tk = useTranslations("channels.kit");
  const locale = useLocale();
  const relay = useDeliveryCapability();
  const labels = commsStatusLabels(tc);
  const all = feed.feed.messages;
  const dead = all ? deadCount(all) : 0;
  const shown = ledger ?? [];

  const verdictTip = (m: Message) => {
    const v = commsVerdict(m);
    if (v === "failed") return `${labels.failed}: ${m.failureDetail ? tc("failureDetail", { detail: m.failureDetail }) : tc("failureDetailUnknown")}`;
    if (v === "bounced") return `${labels.bounced}: ${m.bounceDetail ?? "—"}`;
    if (v === "orphaned") return `${labels.orphaned}. ${tc("orphanHint")}`;
    if (v === "queued" && !feed.relayConfigured) return `${labels.queued}. ${tk("queuedTip")}`;
    return labels[v];
  };

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "name", label: `${tc("colName")} · ${tc("colRole")}`, track: "name", primary: true },
    { id: "subject", label: tk("colSubject"), track: "meta", quiet: true },
    { id: "type", label: tc("colType"), track: "meta+1" },
    { id: "channel", label: tc("colChannel"), track: "fig", numeric: true },
    { id: "recorded", label: tc("colRecorded"), track: "time", numeric: true, tip: tc("recordedHint") },
    { id: "act", label: "", track: "act" },
  ];
  const open = (id: string) => setSel({ kind: "msg", key: id });

  return (
    <>
      <ChannelsKitDelivery sel={sel} setSel={setSel} />
      <Section
        title={t("ledger")}
        count={all ? (feed.feed.hasMore || feed.feed.truncated ? tc("olderExist", { count: all.length }) : tc("count", { count: shown.length })) : undefined}
        tone={feed.relayConfigured ? "default" : "critical"}
        stateMark={feed.relayConfigured ? undefined : <Mark kind="fail" />}
        actions={
          dead ? (
            <ChipButton
              chip={{ id: "dead", label: tc("deadLetters", { count: dead }), mark: <Mark kind="needs" />, pressed: verdict === "dead", onPress: () => setVerdict(verdict === "dead" ? null : "dead") }}
            />
          ) : null
        }
      >
        {/* Only on a KNOWN-false relay: useCommsFeed seeds true, so a read in flight never
            accuses a configured relay of dropping mail. Critical notes carry role=alert. */}
        {feed.relayConfigured ? null : <Note tone="critical">{tc("relayNotConfigured")}</Note>}
        <DataTable
          label={t("ledger")}
          rows={shown}
          columns={columns}
          visibleRows={11}
          metaSplit="minmax(0,1fr) 200px"
          rowKey={(m) => m.id}
          rowState={(m) => (isActionable(m) ? ["needs"] : [])}
          selectedKey={sel?.kind === "msg" ? sel.key : null}
          onSelect={open}
          resetKey={`${verdict}`}
          state={feed.error ? "error" : all === null ? "loading" : "ready"}
          loadingText={tc("loading")}
          errorText={tc("loadFailed")}
          onRetry={() => feed.load()}
          emptyText={filtered ? tk("noMatch") : tc("empty")}
          cells={(m) => {
            const role = ledgerRole(m, refs);
            const door = resendDoorOf({ verdict: commsVerdict(m), channel: m.channel });
            return [
              <Mark key="m" kind={VERDICT_MARK[commsVerdict(m)]} tip={verdictTip(m)} />,
              <>
                {ledgerName(m, refs, receipt)}
                {isUnaddressable(m, relay) ? <> <Mark kind="caution" tip={tc("noAddressHint")} /></> : null}
                <small>{role ?? <span className="k-absent">{"—"}</span>}</small>
              </>,
              displaySubject(m, receipt) ?? "",
              m.kind ? humanKind(m.kind) : "",
              m.channel ? labelize(m.channel) : "",
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
                  open(m.id);
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
      </Section>
    </>
  );
}

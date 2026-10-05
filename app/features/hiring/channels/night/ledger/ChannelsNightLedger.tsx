"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Note, SearchField, stepKey } from "@/app/_components/kit";
import { commsReceiptLabels, displayRecipient, displaySubject } from "../../channelsCommsHelpers";
import type { useChannelData } from "../../useChannelsData";
import type { useCommsFeed } from "../../useCommsFeed";
import { NODE_NAME } from "../channelsNightCopy";
import type { NightChannel, NightEntry } from "../channelsNightNav";
import { ChannelsNightLedgerAlarm } from "./ChannelsNightLedgerAlarm";
import { ChannelsNightLedgerChips } from "./ChannelsNightLedgerChips";
import { ChannelsNightLedgerFacets } from "./ChannelsNightLedgerFacets";
import { ChannelsNightLedgerTable } from "./ChannelsNightLedgerTable";
import {
  LEDGER_CHIPS, NO_FACETS, chipForKey, filterLedger, ledgerCounts, ledgerName, ledgerRole, relayFact, scopeRoles, toggleVerdict,
  type LedgerFacets, type LedgerQuery, type VerdictFilter,
} from "./channelsNightLedgerModel";
import { useNightLevelKeys } from "./useNightLevelKeys";
import "./ledger.css";

// A focused control keeps its own Enter (a chip, a select, the row's button).
const INTERACTIVE = "button, a, input, select, textarea, summary, [role='button']";

/**
 * The post book's body (level 2): the relay's truth first, then the verdict chips, the search and
 * the Role / Type / Channel facets, the scope a channel's "Open the ledger" carried, and the
 * windowed rows. It reads the shell's ONE feed and the shell's receivers / roles (for the scope);
 * it never reads a second copy. The level opens with the filter it was given (a verdict, a role,
 * the channel it came from). Keys (only while this level is on top): 1-7 a verdict chip, / the
 * search, j k (and ↑ ↓ inside the rows) a row, Enter opens it; Esc is the shell's.
 */
export function ChannelsNightLedger({ entry, feed, data, onOpenMessage, onOpenChannel }: {
  entry: Extract<NightEntry, { level: 2 }>;
  feed: ReturnType<typeof useCommsFeed>;
  data: ReturnType<typeof useChannelData>;
  onOpenMessage: (id: string, list: string[], el: HTMLElement | null) => void;
  onOpenChannel: (channel: NightChannel, el: HTMLElement | null) => void;
}) {
  const t = useTranslations();
  const tc = useTranslations("channels.comms");
  const tk = useTranslations("channels.kit");
  const tl = useTranslations("channelsNight.ledger");
  const rootRef = useRef<HTMLDivElement>(null);
  const receipt = useMemo(() => commsReceiptLabels(tc), [tc]);
  const [verdict, setVerdict] = useState<VerdictFilter>(entry.verdict);
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState<LedgerFacets>({ ...NO_FACETS, role: entry.role ?? "" });
  const [scoped, setScoped] = useState(entry.from !== null);
  const [selected, setSelected] = useState<string | null>(null);
  const { messages, refs, hasMore, truncated } = feed.feed;
  const scope = useMemo(() => (scoped ? scopeRoles(entry.from, data.webhooks, data.jobs) : null), [scoped, entry.from, data.webhooks, data.jobs]);

  const query: LedgerQuery = useMemo(
    () => ({
      verdict, q, facets, scope,
      nameOf: (m) => ledgerName(m, refs, receipt),
      subjectOf: (m) => displaySubject(m, receipt),
      recipientOf: (m) => displayRecipient(m, receipt),
      roleOf: (m) => ledgerRole(m, refs),
    }),
    [verdict, q, facets, scope, refs, receipt],
  );
  const rows = useMemo(() => (messages ? filterLedger(messages, query) : null), [messages, query]);
  const counts = useMemo(() => (messages ? ledgerCounts(messages, query) : null), [messages, query]);
  const filtered = Boolean(verdict || q.trim() || facets.role || facets.channel || facets.kind || scope);

  const open = (id: string) => {
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-select="${CSS.escape(id)}"]`);
    setSelected(id);
    onOpenMessage(id, (rows ?? []).map((m) => m.id), row?.querySelector<HTMLElement>("button") ?? row ?? null);
  };
  const step = (delta: 1 | -1) => setSelected((cur) => stepKey((rows ?? []).map((m) => m.id), cur, delta));

  useNightLevelKeys(rootRef, (e) => {
    const chip = chipForKey(e.key);
    if (chip) {
      // The digit PRESSES its chip: a key and a click are one path, so a disabled chip (a zero or a
      // dash) refuses the key exactly as it refuses the pointer.
      const button = rootRef.current?.querySelectorAll<HTMLButtonElement>(".cn-ledger__chips .k-chip")[LEDGER_CHIPS.indexOf(chip)];
      if (!button || button.disabled) return false;
      button.click();
      return true;
    }
    if (e.key === "/") {
      rootRef.current?.querySelector<HTMLInputElement>('[data-role="kit-search"] input')?.focus();
      return true;
    }
    const inRows = e.target instanceof Element && e.target.closest(".k-table__viewport") !== null;
    if (e.key === "j" || e.key === "k" || (inRows && (e.key === "ArrowDown" || e.key === "ArrowUp"))) {
      step(e.key === "j" || e.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if (e.key === "Enter" && selected && !(e.target instanceof Element && e.target.closest(INTERACTIVE))) {
      open(selected);
      return true;
    }
    return false;
  });

  const from = entry.from;
  return (
    <div ref={rootRef} className="cn-ledger">
      <ChannelsNightLedgerAlarm
        fact={relayFact(messages, feed.relayConfigured)}
        onConfigure={(el) => onOpenChannel("relay", el)}
        onShowQueued={() => setVerdict("queued")}
      />
      {messages && feed.error ? (
        <Note tone="caution" action={<Button label={t("common.retry")} variant="ghost" size="sm" onClick={() => feed.load()} />}>{tl("staleRead")}</Note>
      ) : null}
      {counts ? (
        <ChannelsNightLedgerChips
          counts={counts}
          verdict={verdict}
          relayConfigured={feed.relayConfigured}
          olderExist={hasMore || truncated}
          loaded={messages?.length ?? 0}
          onToggle={(chip) => setVerdict(toggleVerdict(verdict, chip))}
        />
      ) : null}
      <div className="cn-ledger__filters">
        {messages ? <ChannelsNightLedgerFacets messages={messages} roleOf={(m) => ledgerRole(m, refs)} facets={facets} setFacets={setFacets} /> : null}
        <div className="cn-ledger__search">
          <SearchField label={tk("search")} value={q} onChange={setQ} />
        </div>
      </div>
      {scope && from ? (
        <p className="cn-ledger__scope">
          {scope.length ? tl("scope", { count: scope.length, channel: t(NODE_NAME[from]) }) : tl("scopeNone", { channel: t(NODE_NAME[from]) })}{" "}
          <Button label={tl("showAll")} variant="link" size="sm" onClick={() => setScoped(false)} />
        </p>
      ) : null}
      <ChannelsNightLedgerTable
        feed={feed}
        rows={rows}
        refs={refs}
        receipt={receipt}
        filtered={filtered}
        selectedKey={selected}
        resetKey={`${verdict}|${scoped}`}
        onOpen={open}
      />
    </div>
  );
}

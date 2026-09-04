"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { CHIP_TOGGLE } from "@/app/_components/ui/recipes";
import { ChannelEmpty } from "./ChannelsEmpty";
import { commsStatusLabels, isActionable, statusTone, type Message, commsReceiptLabels, displayRecipient, displaySubject } from "./channelsCommsHelpers";
import { ChannelsCommsMessageModal } from "./ChannelsCommsMessageModal";
import { ChannelsCommsRows } from "./ChannelsCommsRows";
import { EMPTY_COMMS_PAGE, mergeCommsPage, type CommsPageState } from "./channelsCommsPaging";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";

/** Rows per read. The ledger pages CLIENT-side inside what it has loaded, and asks
 *  the route for one cursor page at a time: `?limit=500` (the whole derivation window)
 *  made `hasMore` structurally unreachable, so the "older rows exist" fact the route
 *  answers had no way to be true and the ledger could only ever end silently. */
const COMMS_PAGE_SIZE = 200;

// Communications, redesigned as a compact, column-filterable register (the JD
// Ledger pattern) instead of the old expand-in-place card list: one row per
// message, filter by channel / role / name, click a row to read the full body and
// resend a dead letter. Self-fetching so either prototype variant can just drop it
// in. (Native <select> filters are round-1 — a themed dropdown is a later upgrade.)
//
// channels-i18n-honesty: the column headers, the status vocabulary and the date column
// all resolve through `channels.comms.*` in four locales. The date column is also the
// one that used to lie by omission — see formatRecordedAt in channelsCommsHelpers.ts.
//
// Render cascade: the ledger's CHROME — the caption, the column headers and the
// filters that live in them — depends on nothing but client state, so it paints on
// the first frame and only the ROWS wait for /api/comms. It used to return a single
// blank reserved-height box until the fetch settled, which meant a filter control
// that was already fully determined arrived a network round-trip late.

export function CommsTable() {
  const t = useTranslations("channels.comms");
  const locale = useLocale();
  // One state, folded by a pure reducer (channelsCommsPaging.ts): the rows, the refs
  // and the two SEPARATE facts about size — `hasMore` (more rows a cursor reaches) and
  // `truncated` (older rows past the derivation window that no cursor reaches).
  const [feed, setFeed] = useState<CommsPageState>(EMPTY_COMMS_PAGE);
  const { messages, refs } = feed;
  const [error, setError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [relayConfigured, setRelayConfigured] = useState(true);
  const [nameQuery, setNameQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [actionableOnly, setActionableOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  // Any filter change re-cuts the result set, so it also returns to the first page:
  // staying on page 3 of a list that just became a different list is disorienting,
  // and the clamp alone (below) only catches the case where the list got shorter.
  const onFirstPage =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
    };

  // One read of the feed. `cursor` null = the head of the ledger (first load and every
  // live refresh, both of which re-read the newest page); a cursor = the next older
  // page, folded onto what is already on screen.
  const read = useCallback((cursor: string | null, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ limit: String(COMMS_PAGE_SIZE) });
    if (cursor) qs.set("cursor", cursor);
    return fetch(`/api/comms?${qs.toString()}`, { signal }).then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    });
  }, []);

  const load = useCallback(
    (signal?: AbortSignal) => {
      read(null, signal)
        .then((p) => {
          setRelayConfigured(p.relayConfigured !== false);
          // A body with no `messages` array is a FAILURE, not an empty ledger — the
          // reducer refuses to conjure one (channelsCommsPaging.ts). A head read
          // carries no state forward, so it folds onto EMPTY.
          const next = mergeCommsPage(EMPTY_COMMS_PAGE, p, "replace");
          setError(next === null);
          if (next) setFeed(next);
        })
        .catch(() => {
          // An abort is this component unmounting, not a load failure: raising the
          // error banner for it would paint a red ledger on the way out.
          if (!signal?.aborted) setError(true);
        });
    },
    [read]
  );
  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);
  useLiveRefresh(load);

  const loadOlder = useCallback(() => {
    if (loadingOlder || !feed.cursor) return;
    setLoadingOlder(true);
    read(feed.cursor)
      .then((p) => {
        setFeed((prev) => mergeCommsPage(prev, p, "append") ?? prev);
      })
      .catch(() => setError(true))
      .finally(() => setLoadingOlder(false));
  }, [read, feed.cursor, loadingOlder]);

  const roleOf = useCallback((m: Message) => (m.ref ? refs[m.ref]?.jobTitle ?? null : null), [refs]);
  // Receipt rows have no candidate and a CODE where a recipient goes — localized here
  // rather than stored in English (see channelsCommsHelpers).
  const receiptLabels = useMemo(() => commsReceiptLabels(t), [t]);
  const nameOf = useCallback(
    (m: Message) => (m.ref ? refs[m.ref]?.label : null) ?? displayRecipient(m, receiptLabels) ?? "—",
    [refs, receiptLabels]
  );

  // Distinct column values drive the dropdowns — only what's actually present.
  // Czech-aware ordering: a plain .sort() compares UTF-16 code points, which puts
  // Č/Ř/Š/Ž after Z and reads as broken to anyone using the app in cs.
  const collator = useMemo(() => new Intl.Collator(locale), [locale]);
  const channels = useMemo(
    () => [...new Set((messages ?? []).map((m) => m.channel).filter((c): c is string => Boolean(c)))].sort(collator.compare),
    [messages, collator]
  );
  const roles = useMemo(
    () => [...new Set((messages ?? []).map((m) => roleOf(m)).filter((r): r is string => Boolean(r)))].sort(collator.compare),
    [messages, roleOf, collator]
  );
  const kinds = useMemo(
    () => [...new Set((messages ?? []).map((m) => m.kind).filter((k): k is string => Boolean(k)))].sort(collator.compare),
    [messages, collator]
  );
  // Status options mirror the displayed labels (Sent / Failed / Bounced / …) so the
  // Status column filter reads the same as the column it filters, in every locale.
  const statusLabels = useMemo(() => commsStatusLabels(t), [t]);
  const statuses = useMemo(
    () => [...new Set((messages ?? []).map((m) => statusTone(m, statusLabels).label))].sort(collator.compare),
    [messages, statusLabels, collator]
  );

  if (error) {
    return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{t("loadFailed")}</p>;
  }
  // Tier 2 (docs/design/loading-choreography.md): the first fetch is in flight. The
  // chrome below renders anyway; only the rows region holds a quiet reserved height.
  const loading = messages === null;
  const all = messages ?? [];

  const needle = nameQuery.trim().toLowerCase();
  const matchesQuery = (m: Message) =>
    !needle ||
    nameOf(m).toLowerCase().includes(needle) ||
    (displaySubject(m, receiptLabels) ?? "").toLowerCase().includes(needle) ||
    (displayRecipient(m, receiptLabels) ?? "").toLowerCase().includes(needle);

  const failedCount = all.filter(isActionable).length;
  // Dead letters first, then newest-first within each group.
  const sorted = [...all].sort((a, b) => {
    const aa = isActionable(a);
    const bb = isActionable(b);
    if (aa !== bb) return aa ? -1 : 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
  const filtered = sorted.filter(
    (m) =>
      (!actionableOnly || isActionable(m)) &&
      (!channelFilter || m.channel === channelFilter) &&
      (!roleFilter || roleOf(m) === roleFilter) &&
      (!kindFilter || m.kind === kindFilter) &&
      (!statusFilter || statusTone(m, statusLabels).label === statusFilter) &&
      matchesQuery(m)
  );
  // Clamped, not reset: filtering down to fewer pages while the reader sits on the
  // last one must land them on a page that exists, without an effect that could
  // fight the setter above.
  const safePage = clampPage(page, filtered.length);
  const shown = pageSlice(filtered, safePage);
  const open = openId ? all.find((m) => m.id === openId) ?? null : null;

  return (
    <div className="animate-arrive-in space-y-3">
      {/* Only ever shown on a KNOWN-false relay: `relayConfigured` seeds true, so a
          fetch in flight never accuses a configured relay of dropping mail. */}
      {!relayConfigured ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red-300 bg-red-50 p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" aria-hidden />
          <p className="text-sm font-medium text-red-800">{t("relayNotConfigured")}</p>
        </div>
      ) : null}

      {/* Caption: total + a one-click "chase dead letters". The per-column filters
          live IN the table headers below — no separate filter row. */}
      <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
        {loading ? (
          <span className="reveal-quiet inline-block h-4 w-24 rounded bg-stone-100" aria-hidden />
        ) : (
          // "N messages" is only true when N is the whole ledger. With older rows
          // still out there — reachable by cursor, or past the derivation window
          // entirely — the caption says what it is SHOWING and that more exists.
          <p className="text-sm text-steel">
            {feed.hasMore || feed.truncated ? t("olderExist", { count: all.length }) : t("count", { count: all.length })}
          </p>
        )}
        {failedCount > 0 ? (
          <button
            type="button"
            aria-pressed={actionableOnly}
            onClick={() => {
              setActionableOnly((f) => !f);
              setPage(0);
            }}
            className={CHIP_TOGGLE(actionableOnly)}
          >
            <AlertTriangle size={12} aria-hidden /> {t("deadLetters", { count: failedCount })}
          </button>
        ) : null}
      </div>

      {!loading && filtered.length === 0 ? (
        // Only the genuine first-run case (no messages at all) gets the illustrated
        // brief. A list filtered to zero keeps the one-line message — an illustrated
        // "nothing here yet" on a filter result would lie about the ledger's contents.
        all.length === 0 ? (
          <ChannelEmpty section="comms" connected={relayConfigured} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
            <Inbox size={22} className="text-steel" aria-hidden />
            <p className="text-sm text-steel">{t("empty")}</p>
          </div>
        )
      ) : (
        // Renders on the first frame — with `loading`, the header row and its column
        // filters are real and usable while the body holds a quiet reserved height.
        <ChannelsCommsRows
          shown={shown}
          loading={loading}
          relayConfigured={relayConfigured}
          roleOf={roleOf}
          nameOf={nameOf}
          nameQuery={nameQuery}
          setNameQuery={onFirstPage(setNameQuery)}
          roleFilter={roleFilter}
          setRoleFilter={onFirstPage(setRoleFilter)}
          roles={roles}
          channelFilter={channelFilter}
          setChannelFilter={onFirstPage(setChannelFilter)}
          channels={channels}
          kindFilter={kindFilter}
          setKindFilter={onFirstPage(setKindFilter)}
          kinds={kinds}
          statusFilter={statusFilter}
          setStatusFilter={onFirstPage(setStatusFilter)}
          statuses={statuses}
          statusLabels={statusLabels}
          onOpen={setOpenId}
        />
      )}

      <TablePager page={safePage} total={filtered.length} onPage={setPage} />

      {/* Reaching further back. The button only appears while a CURSOR reaches more
          rows; once it does not, the sentence is the whole affordance — the oldest
          rows sit outside the derivation window and no amount of clicking gets them,
          which is exactly the fact a "load older" button that did nothing would hide. */}
      {!loading && (feed.hasMore || feed.truncated) ? (
        <div className="flex flex-wrap items-center gap-3">
          {feed.hasMore ? (
            <button type="button" onClick={loadOlder} disabled={loadingOlder} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
              {loadingOlder ? t("loadingOlder") : t("loadOlder")}
            </button>
          ) : null}
          {!feed.hasMore && feed.truncated ? <p className="text-sm text-steel">{t("beyondWindow")}</p> : null}
        </div>
      ) : null}

      {open ? (
        <ChannelsCommsMessageModal
          message={open}
          name={nameOf(open)}
          roleLabel={roleOf(open)}
          statusLabels={statusLabels}
          receiptLabels={receiptLabels}
          onClose={() => setOpenId(null)}
          onResent={load}
        />
      ) : null}
    </div>
  );
}

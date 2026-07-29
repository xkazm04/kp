"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { CHIP_TOGGLE } from "@/app/_components/ui/recipes";
import { ChannelEmpty } from "./ChannelsEmpty";
import { commsStatusLabels, isActionable, statusTone, PAGE_SIZE, type Message, type RefInfo } from "./channelsCommsHelpers";
import { ChannelsCommsMessageModal } from "./ChannelsCommsMessageModal";
import { ChannelsCommsRows } from "./ChannelsCommsRows";

// Communications, redesigned as a compact, column-filterable register (the JD
// Ledger pattern) instead of the old expand-in-place card list: one row per
// message, filter by channel / role / name, click a row to read the full body and
// resend a dead letter. Self-fetching so either prototype variant can just drop it
// in. (Native <select> filters are round-1 — a themed dropdown is a later upgrade.)
//
// channels-i18n-honesty: the column headers, the status vocabulary and the date column
// all resolve through `channels.comms.*` in four locales. The date column is also the
// one that used to lie by omission — see formatRecordedAt in channelsCommsHelpers.ts.

export function CommsTable() {
  const t = useTranslations("channels.comms");
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [refs, setRefs] = useState<Record<string, RefInfo>>({});
  const [error, setError] = useState(false);
  const [relayConfigured, setRelayConfigured] = useState(true);
  const [nameQuery, setNameQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [actionableOnly, setActionableOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/comms")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => {
        setMessages((p.messages as Message[]) ?? []);
        setRefs((p.entries as Record<string, RefInfo>) ?? {});
        setRelayConfigured(p.relayConfigured !== false);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load);

  const roleOf = useCallback((m: Message) => (m.ref ? refs[m.ref]?.jobTitle ?? null : null), [refs]);
  const nameOf = useCallback((m: Message) => (m.ref ? refs[m.ref]?.label : null) ?? m.recipient ?? "—", [refs]);

  // Distinct column values drive the dropdowns — only what's actually present.
  const channels = useMemo(
    () => [...new Set((messages ?? []).map((m) => m.channel).filter((c): c is string => Boolean(c)))].sort(),
    [messages]
  );
  const roles = useMemo(
    () => [...new Set((messages ?? []).map((m) => roleOf(m)).filter((r): r is string => Boolean(r)))].sort(),
    [messages, roleOf]
  );
  const kinds = useMemo(
    () => [...new Set((messages ?? []).map((m) => m.kind).filter((k): k is string => Boolean(k)))].sort(),
    [messages]
  );
  // Status options mirror the displayed labels (Sent / Failed / Bounced / …) so the
  // Status column filter reads the same as the column it filters, in every locale.
  const statusLabels = useMemo(() => commsStatusLabels(t), [t]);
  const statuses = useMemo(
    () => [...new Set((messages ?? []).map((m) => statusTone(m, statusLabels).label))].sort(),
    [messages, statusLabels]
  );

  if (error) {
    return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{t("loadFailed")}</p>;
  }
  if (messages === null) {
    // Tier 2 (docs/LOADING_CHOREOGRAPHY.md): first fetch in flight, nothing to show
    // yet — hold the ledger's height, stay invisible for 150ms so a fast response
    // never flashes a placeholder at all. Was two pulsing Skeleton slabs.
    return <div className="reveal-quiet min-h-[22rem]" aria-hidden />;
  }

  const needle = nameQuery.trim().toLowerCase();
  const matchesQuery = (m: Message) =>
    !needle ||
    nameOf(m).toLowerCase().includes(needle) ||
    (m.subject ?? "").toLowerCase().includes(needle) ||
    (m.recipient ?? "").toLowerCase().includes(needle);

  const failedCount = messages.filter(isActionable).length;
  // Dead letters first, then newest-first within each group.
  const sorted = [...messages].sort((a, b) => {
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
  const shown = filtered.slice(0, visibleCount);
  const open = openId ? messages.find((m) => m.id === openId) ?? null : null;

  return (
    // Tier 2: the ledger just arrived — fade it in in place (mounts once, when
    // `messages` first goes from null to an array; a later refresh reuses this
    // same element and never re-triggers the animation).
    <div className="animate-arrive-in space-y-3">
      {!relayConfigured ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red-300 bg-red-50 p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" aria-hidden />
          <p className="text-sm font-medium text-red-800">{t("relayNotConfigured")}</p>
        </div>
      ) : null}

      {/* Caption: total + a one-click "chase dead letters". The per-column filters
          live IN the table headers below — no separate filter row. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-steel">{t("count", { count: messages.length })}</p>
        {failedCount > 0 ? (
          <button type="button" aria-pressed={actionableOnly} onClick={() => setActionableOnly((f) => !f)} className={CHIP_TOGGLE(actionableOnly)}>
            <AlertTriangle size={12} aria-hidden /> {t("deadLetters", { count: failedCount })}
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        // Only the genuine first-run case (no messages at all) gets the illustrated
        // brief. A list filtered to zero keeps the one-line message — an illustrated
        // "nothing here yet" on a filter result would lie about the ledger's contents.
        messages.length === 0 ? (
          <ChannelEmpty section="comms" connected={relayConfigured} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
            <Inbox size={22} className="text-steel" aria-hidden />
            <p className="text-sm text-steel">{t("empty")}</p>
          </div>
        )
      ) : (
        <ChannelsCommsRows
          shown={shown}
          relayConfigured={relayConfigured}
          roleOf={roleOf}
          nameOf={nameOf}
          nameQuery={nameQuery}
          setNameQuery={setNameQuery}
          roleFilter={roleFilter}
          setRoleFilter={setRoleFilter}
          roles={roles}
          channelFilter={channelFilter}
          setChannelFilter={setChannelFilter}
          channels={channels}
          kindFilter={kindFilter}
          setKindFilter={setKindFilter}
          kinds={kinds}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          statuses={statuses}
          statusLabels={statusLabels}
          onOpen={setOpenId}
        />
      )}

      {filtered.length > shown.length ? (
        <div className="flex items-center gap-2 text-sm text-steel">
          <span>{t("showing", { shown: shown.length, total: filtered.length })}</span>
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="focus-ring rounded-md border border-stone-200 px-2 py-0.5 font-semibold text-ink hover:bg-stone-50"
          >
            {t("showMore")}
          </button>
        </div>
      ) : null}

      {open ? (
        <ChannelsCommsMessageModal
          message={open}
          name={nameOf(open)}
          roleLabel={roleOf(open)}
          statusLabels={statusLabels}
          onClose={() => setOpenId(null)}
          onResent={load}
        />
      ) : null}
    </div>
  );
}

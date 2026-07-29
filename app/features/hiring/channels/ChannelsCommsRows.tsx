"use client";

// The Comms ledger's table: the column-filter header row and the message rows.
// Split out of ChannelsCommsTable.tsx to keep the table file under the
// 200-line cap. Every header, badge and timestamp resolves through
// `channels.comms.*` (channels-i18n-honesty).

import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { labelize } from "@/app/_lib/format";
import { ColumnFilter, type Option } from "./ChannelsFilters";
import { formatRecordedAt, isActionable, statusTone, type Message, type StatusLabels } from "./channelsCommsHelpers";

export function ChannelsCommsRows({
  shown,
  relayConfigured,
  roleOf,
  nameOf,
  nameQuery,
  setNameQuery,
  roleFilter,
  setRoleFilter,
  roles,
  channelFilter,
  setChannelFilter,
  channels,
  kindFilter,
  setKindFilter,
  kinds,
  statusFilter,
  setStatusFilter,
  statuses,
  statusLabels,
  onOpen,
}: {
  shown: Message[];
  relayConfigured: boolean;
  roleOf: (m: Message) => string | null;
  nameOf: (m: Message) => string;
  nameQuery: string;
  setNameQuery: (v: string) => void;
  roleFilter: string;
  setRoleFilter: (v: string) => void;
  roles: string[];
  channelFilter: string;
  setChannelFilter: (v: string) => void;
  channels: string[];
  kindFilter: string;
  setKindFilter: (v: string) => void;
  kinds: string[];
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  statuses: string[];
  statusLabels: StatusLabels;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("channels.comms");
  const locale = useLocale();
  const asOptions = (values: string[]): Option[] => values.map((v) => ({ value: v, label: v }));
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-stone-200 bg-paper/60">
            <th className="px-3 py-2">
              <ColumnFilter title={t("colName")} mode="search" value={nameQuery} onChange={setNameQuery} />
            </th>
            <th className="px-3 py-2">
              <ColumnFilter title={t("colRole")} value={roleFilter} onChange={setRoleFilter} options={asOptions(roles)} />
            </th>
            <th className="px-3 py-2">
              <ColumnFilter title={t("colChannel")} value={channelFilter} onChange={setChannelFilter} options={channels.map((c) => ({ value: c, label: labelize(c) }))} />
            </th>
            <th className="px-3 py-2">
              <ColumnFilter title={t("colType")} value={kindFilter} onChange={setKindFilter} options={kinds.map((k) => ({ value: k, label: labelize(k) }))} />
            </th>
            <th className="px-3 py-2">
              <ColumnFilter title={t("colStatus")} value={statusFilter} onChange={setStatusFilter} options={asOptions(statuses)} />
            </th>
            <th title={t("recordedHint")} className={`px-3 py-2 ${META_LABEL}`}>
              {t("colRecorded")}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => {
            const st = statusTone(m, statusLabels);
            // An unmatched receipt has no candidate address by construction
            // ("(relay callback)"), so the no-address warning is noise on it.
            const unaddressable = relayConfigured && m.deliverable === false && !m.orphaned;
            return (
              <tr
                key={m.id}
                onClick={() => onOpen(m.id)}
                className={`cursor-pointer border-b border-stone-100 text-sm transition-colors last:border-0 hover:bg-paper/70 ${
                  isActionable(m) ? "bg-red-50/40" : ""
                }`}
              >
                <td className="px-3 py-2 font-semibold text-ink">
                  <span className="flex items-center gap-1.5">
                    {nameOf(m)}
                    {unaddressable ? (
                      <span title={t("noAddressHint")} className="inline-flex items-center text-amber-600">
                        <AlertTriangle size={12} aria-hidden />
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="px-3 py-2 text-steel">{roleOf(m) ?? "—"}</td>
                <td className="px-3 py-2 text-steel">{m.channel ? labelize(m.channel) : "—"}</td>
                <td className="px-3 py-2 text-steel">{m.kind ? labelize(m.kind) : "—"}</td>
                <td className="px-3 py-2">
                  <Badge tone={st.tone} label={st.label} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-steel">{formatRecordedAt(m.createdAt, locale)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

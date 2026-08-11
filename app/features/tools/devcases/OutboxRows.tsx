"use client";

// The Assignments outbox table: the column-filter header row and the message rows.
// Split out of OutboxSection.tsx (which owns the filter state, the dead-letter chip
// and the pager) so both stay under the 200-line cap.

import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { OutboxStatus } from "@/app/_lib/comms-status";
import { ResendButton } from "./ResendButton";
import { isDeadLetter, type OutboxFacets, type OutboxFilters } from "./outboxView";
import type { OutboxItem } from "./DevTypes";

// Badge tints by message kind — positive (invite/outreach/ack) vs. adverse (rejection).
const KIND_STYLE: Record<string, string> = {
  invite: "bg-moss/15 text-moss",
  acknowledgement: "bg-moss/15 text-moss",
  outreach: "bg-coral/15 text-coral",
  rejection: "bg-red-50 text-red-700",
};

// Delivery-status tint — `failed`/`bounced` (dead letters) are loud so a dropped
// offer or rejection never reads as benign. `queued` shows the channel instead of a
// status word: locally it is terminal, and calling it "sent" would be a green lie.
const STATUS_STYLE: Record<OutboxStatus, string> = {
  queued: "text-steel",
  sent: "text-moss",
  failed: "text-red-700 font-semibold",
  bounced: "text-red-800 font-semibold",
};

export function OutboxRows({
  shown,
  emptyFiltered,
  onClearFilters,
  filters,
  onFilters,
  facets,
  kindLabel,
  statusLabel,
  onResent,
}: {
  shown: OutboxItem[];
  /** Filters cut a non-empty outbox to zero rows. */
  emptyFiltered: boolean;
  onClearFilters: () => void;
  filters: OutboxFilters;
  onFilters: (patch: Partial<OutboxFilters>) => void;
  facets: OutboxFacets;
  kindLabel: (kind: string) => string;
  statusLabel: (status: OutboxStatus) => string;
  onResent?: () => void;
}) {
  const t = useTranslations("devcase.outbox");
  const rel = useRelativeTime();

  if (emptyFiltered) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
        <Inbox size={22} className="text-steel" aria-hidden />
        <p className="text-sm text-steel">{t("filteredEmpty")}</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="focus-ring rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
        >
          {t("clearFilters")}
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-stone-200 bg-paper/60">
            <th scope="col" className="px-3 py-2">
              <ColumnFilter
                title={t("colKind")}
                value={filters.kind}
                onChange={(kind) => onFilters({ kind })}
                options={facets.kinds}
              />
            </th>
            {/* One search box over recipient AND subject: "who did we mail about
                what" is a single question, and two boxes for it invited the reader
                to guess which field a name lives in. */}
            <th scope="col" className="px-3 py-2">
              <ColumnFilter title={t("colRecipient")} mode="search" value={filters.q} onChange={(q) => onFilters({ q })} />
            </th>
            <th scope="col" className={`px-3 py-2 ${META_LABEL}`}>
              {t("colSubject")}
            </th>
            <th scope="col" className="px-3 py-2">
              <ColumnFilter
                title={t("colStatus")}
                value={filters.status}
                onChange={(status) => onFilters({ status })}
                options={facets.statuses}
              />
            </th>
            <th scope="col" className={`hidden whitespace-nowrap px-3 py-2 sm:table-cell ${META_LABEL}`}>
              {t("colSent")}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <tr
              key={m.id}
              className={`border-b border-stone-100 last:border-b-0 ${isDeadLetter(m) ? "bg-red-50/40" : ""}`}
            >
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-micro font-semibold uppercase ${
                    KIND_STYLE[m.kind ?? ""] ?? "bg-paper text-steel"
                  }`}
                >
                  {kindLabel(m.kind ?? "")}
                </span>
              </td>
              <td className="max-w-0 truncate px-3 py-2 text-sm text-steel sm:max-w-40">{m.recipient}</td>
              <td className="max-w-0 truncate px-3 py-2 text-sm text-ink">{m.subject}</td>
              <td className={`whitespace-nowrap px-3 py-2 text-micro uppercase ${STATUS_STYLE[m.status] ?? "text-steel"}`}>
                <span className="inline-flex items-center gap-1.5">
                  {m.status === "queued" ? `${m.channel}` : statusLabel(m.status)}
                  {/* `failed` only. A BOUNCED row is one the relay accepted and then
                      rejected, so re-sending it to the same address just bounces
                      again — that case needs the corrected-address form (Channels'
                      BouncedResend), not a one-click retry. It still sorts and
                      highlights as a dead letter here. */}
                  {m.status === "failed" ? <ResendButton id={m.id} onResent={onResent} compact /> : null}
                </span>
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2 text-sm text-steel sm:table-cell">{rel(m.createdAt) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

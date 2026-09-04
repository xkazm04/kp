"use client";

// The Assignments outbox table: the column-filter header row and the message rows.
// Split out of OutboxSection.tsx (which owns the filter state, the dead-letter chip
// and the pager) so both stay under the 200-line cap.

import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { BTN_PRIMARY, META_LABEL } from "@/app/_components/ui/recipes";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { CommsVerdict } from "@/app/_lib/comms-view";
// Cross-feature, deliberately: the receipt labels are ONE wording, and the Comms
// Center's copy is the one that already exists in four locales (precedent:
// DevVoiceScreenPanel reaching into features/hiring/pipeline).
import { commsReceiptLabels, displayRecipient, displaySubject } from "@/app/features/hiring/channels/channelsCommsHelpers";
import { ResendButton } from "./ResendButton";
import { isDeadLetter, type OutboxFacets, type OutboxFilters, type OutboxRowView } from "./outboxView";

// Badge tints by message kind — positive (schedule invite/outreach/ack) vs. adverse
// (rejection). Keyed by the wire codes KNOWN_COMM_KINDS actually emits: an "invite"
// key sat here for rounds, tinting nothing, while the real `schedule_invite` fell
// through to the neutral default (outbox-kind-catalog.test.ts tells the same story
// about the i18n catalog that was authored from the same guess).
const KIND_STYLE: Record<string, string> = {
  acknowledgement: "bg-moss/15 text-moss",
  schedule_invite: "bg-moss/15 text-moss",
  interview_invite: "bg-moss/15 text-moss",
  interview_confirmation: "bg-moss/15 text-moss",
  interview_reminder: "bg-moss/15 text-moss",
  offer: "bg-moss/15 text-moss",
  offer_reminder: "bg-moss/15 text-moss",
  outreach: "bg-coral/15 text-coral",
  rejection: "bg-red-50 text-red-700",
  ko_decline: "bg-red-50 text-red-700",
};

// Tint for the DERIVED delivery verdict (comms-view.ts `commsVerdict`) — the same
// tone split the candidate drawer uses (PipelineCommsList): `failed`/`bounced` are
// loud so a dropped or undeliverable offer never reads as benign; `orphaned` is a
// relay-integration fault rather than a message, so it is caution, not alarm;
// `recovered` is green because a later resend did reach the relay. `queued` shows the
// channel instead of a status word: locally it is terminal, and calling it "sent"
// would be a green lie.
const VERDICT_STYLE: Record<CommsVerdict, string> = {
  queued: "text-steel",
  sent: "text-moss",
  recovered: "text-moss",
  orphaned: "text-amber-700 font-semibold",
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
  shown: OutboxRowView[];
  /** Filters cut a non-empty outbox to zero rows. */
  emptyFiltered: boolean;
  onClearFilters: () => void;
  filters: OutboxFilters;
  onFilters: (patch: Partial<OutboxFilters>) => void;
  facets: OutboxFacets;
  kindLabel: (kind: string) => string;
  statusLabel: (verdict: CommsVerdict) => string;
  onResent?: () => void;
}) {
  const t = useTranslations("devcase.outbox");
  // A delivery-receipt row stores CODES where a message stores a subject and a
  // recipient (comms-view.ts RECEIPT_*_CODE) — this table rendered them raw, so a new
  // receipt read as the bare word "receipt" and an old one as English in every locale.
  const tComms = useTranslations("channels.comms");
  const receiptLabels = commsReceiptLabels(tComms);
  const rel = useRelativeTime();

  if (emptyFiltered) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
        <Inbox size={22} className="text-steel" aria-hidden />
        <p className="text-sm text-steel">{t("filteredEmpty")}</p>
        <button
          type="button"
          onClick={onClearFilters}
          // The shared primary action, not a re-typed class string: hand-rolled, this
          // button carried none of the dual-theme press-down the rest of the studio has.
          className={`${BTN_PRIMARY} h-9 rounded-full px-4`}
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
              <td className="max-w-0 truncate px-3 py-2 text-sm text-steel sm:max-w-40">{displayRecipient(m, receiptLabels)}</td>
              <td className="max-w-0 truncate px-3 py-2 text-sm text-ink">{displaySubject(m, receiptLabels)}</td>
              <td className={`whitespace-nowrap px-3 py-2 text-micro uppercase ${VERDICT_STYLE[m.verdict] ?? "text-steel"}`}>
                <span className="inline-flex items-center gap-1.5">
                  {m.verdict === "queued" ? m.channel ?? statusLabel(m.verdict) : statusLabel(m.verdict)}
                  {/* An UNRECOVERED `failed` only. A BOUNCED row is one the relay
                      accepted and then rejected, so re-sending it to the same address
                      just bounces again — that case needs the corrected-address form
                      (Channels' BouncedResend), not a one-click retry. And a
                      `recovered` one already has a later delivery: offering the button
                      there produced a 409 "already re-sent" that reads like a fresh
                      failure. Both still sort and highlight by their own verdict. */}
                  {m.verdict === "failed" ? <ResendButton id={m.id} onResent={onResent} compact /> : null}
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

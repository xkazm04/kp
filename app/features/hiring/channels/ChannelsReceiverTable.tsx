"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Copy, Trash2 } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { Modal } from "@/app/_components/Modal";
import { BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { isReceiverLive } from "@/app/features/hiring/channels/useChannelsReceivers";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { useCopyState } from "./useCopyState";

// One receiver per row — the compact table both the Email intake and Ad forms panes
// render. `endpointFor` yields the per-channel address (an email forwarding address,
// or a receiver URL). `onSelect` (email only) highlights the row whose setup guide
// shows. All copy resolves through the `channels.*` catalog (channels-i18n-honesty).
//
// Paged in 20s like every other studio table (_components/table/TablePager). A workspace
// with one receiver per open role reaches three figures; the selected row drives the
// setup guide rendered directly BELOW this table, so an unbounded list would push
// the guide off-screen away from the row that owns it.

function CopyBtn({ value }: { value: string }) {
  const t = useTranslations("channels");
  // A DENIED clipboard says so (useCopyState): this endpoint is what a recruiter
  // pastes into a forwarding rule, and a silent failure meant pasting a stale one.
  const { state, copy } = useCopyState();
  const failed = state === "failed";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copy(value);
      }}
      aria-label={t("receivers.copyEndpoint")}
      aria-live="polite"
      className={`focus-ring inline-flex items-center gap-1 rounded-md border bg-white px-1.5 py-0.5 text-xs font-semibold hover:border-coral/40 ${
        failed ? "border-red-300 text-red-700" : "border-stone-200 text-ink"
      }`}
    >
      {failed ? <AlertTriangle size={12} /> : state === "copied" ? <Check size={12} /> : <Copy size={12} />}{" "}
      {failed ? t("copyFailed") : state === "copied" ? t("copied") : t("copy")}
    </button>
  );
}

export function ReceiverTable({
  receivers,
  endpointFor,
  endpointLabel,
  onRevoke,
  revoking,
  selectedToken,
  onSelect,
}: {
  receivers: ChannelWebhookRecord[];
  endpointFor: (token: string) => string;
  endpointLabel: string;
  onRevoke: (token: string) => void;
  revoking: string | null;
  selectedToken?: string | null;
  onSelect?: (token: string) => void;
}) {
  const t = useTranslations("channels");
  // Revoking a receiver DELETEs a live, externally-wired intake endpoint (a Gmail
  // forwarding rule / a Zapier→Meta flow now POSTs to a dead URL) and there is no
  // un-revoke. So the trash icon opens a confirm step that names the role and warns
  // the external source will break — a mis-click must not silently drop a role's
  // inbound applications.
  const [confirmRow, setConfirmRow] = useState<ChannelWebhookRecord | null>(null);
  const confirmLive = confirmRow ? isReceiverLive(confirmRow) : false;
  // Clamped rather than reset (see _components/table/TablePager): revoking the last receiver
  // on the final page must land the reader on a page that still exists.
  const [page, setPage] = useState(0);
  const safePage = clampPage(page, receivers.length);
  const shown = pageSlice(receivers, safePage);
  return (
    <>
    <div className="space-y-3">
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-paper/60">
            <th className={`px-3 py-2 ${META_LABEL}`}>{t("receivers.role")}</th>
            <th className={`px-3 py-2 ${META_LABEL}`}>{endpointLabel}</th>
            <th className={`px-3 py-2 ${META_LABEL}`}>{t("receivers.lang")}</th>
            <th className={`px-3 py-2 ${META_LABEL}`}>{t("receivers.status")}</th>
            {/* Raw AUTHENTICATED POSTs — connectivity, not leads (db/channels.ts). */}
            <th title={t("receivers.receivedHint")} className={`px-3 py-2 text-right ${META_LABEL}`}>
              {t("receivers.received")}
            </th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {shown.map((h) => {
            const live = isReceiverLive(h);
            const selected = selectedToken === h.token;
            const endpoint = endpointFor(h.token);
            return (
              <tr
                key={h.token}
                onClick={onSelect ? () => onSelect(h.token) : undefined}
                className={`border-b border-stone-100 text-sm last:border-0 ${onSelect ? "cursor-pointer" : ""} ${
                  selected ? "bg-coral/5" : "hover:bg-paper/60"
                }`}
              >
                <td className="px-3 py-2 font-semibold text-ink">{h.jobTitle ?? h.jobId}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <code className="inline-block max-w-[15rem] truncate rounded bg-stone-100 px-1.5 py-0.5 align-middle text-xs text-ink">{endpoint}</code>
                    <CopyBtn value={endpoint} />
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="rounded-full border border-stone-200 px-1.5 text-micro font-semibold uppercase text-steel">{h.lang ?? DEFAULT_LOCALE}</span>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={live ? "positive" : "neutral"} dot={live} label={live ? t("statusListening") : t("statusWaiting")} />
                </td>
                <td className="px-3 py-2 text-right text-steel nums">{h.receivedCount}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmRow(h);
                    }}
                    disabled={revoking === h.token}
                    title={t("receivers.remove")}
                    aria-label={t("receivers.removeAria", { role: h.jobTitle ?? h.jobId })}
                    className="focus-ring inline-flex items-center rounded-md border border-stone-200 bg-white p-1 text-steel hover:border-coral/40 hover:text-coral disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      <TablePager page={safePage} total={receivers.length} onPage={setPage} />
    </div>

    {confirmRow ? (
      <Modal title={t("receivers.confirmTitle")} onClose={() => setConfirmRow(null)} size="md">
        <div className="space-y-4">
          <p className="text-sm text-steel">
            {t.rich("receivers.confirmBody", {
              role: confirmRow.jobTitle ?? confirmRow.jobId,
              endpoint: endpointLabel,
              b: (chunks) => <b className="text-ink">{chunks}</b>,
            })}
          </p>
          {confirmLive ? (
            <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
              <Trash2 size={14} className="mt-0.5 shrink-0" aria-hidden />
              {t("receivers.confirmLive", { count: confirmRow.receivedCount })}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 border-t border-stone-100 pt-3">
            <button type="button" onClick={() => setConfirmRow(null)} className={`${BTN_SECONDARY} h-9 px-4 text-sm`}>
              {t("receivers.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                onRevoke(confirmRow.token);
                setConfirmRow(null);
              }}
              className="focus-ring inline-flex h-9 items-center rounded-md bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
            >
              {t("receivers.confirm")}
            </button>
          </div>
        </div>
      </Modal>
    ) : null}
    </>
  );
}

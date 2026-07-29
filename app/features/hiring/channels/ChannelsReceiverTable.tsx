"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, Trash2 } from "lucide-react";
import { buildTabSwitchUrl } from "@/app/features/shell/tabs";
import { Badge } from "@/app/_components/Badge";
import { Modal } from "@/app/_components/Modal";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locales";
import type { ChannelWebhookRecord } from "@/app/_lib/db";
import { SearchSelect } from "@/app/features/hiring/channels/ChannelsFilters";
import { isReceiverLive, type ReceiverJob } from "@/app/features/hiring/channels/useChannelsReceivers";

// One receiver per row — the compact table both the Email intake and Ad forms panes
// render. `endpointFor` yields the per-channel address (an email forwarding address,
// or a receiver URL). `onSelect` (email only) highlights the row whose setup guide
// shows. All copy resolves through the `channels.*` catalog (channels-i18n-honesty).

function CopyBtn({ value }: { value: string }) {
  const t = useTranslations("channels");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
      aria-label={t("receivers.copyEndpoint")}
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-ink hover:border-coral/40"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t("copied") : t("copy")}
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
  return (
    <>
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
          {receivers.map((h) => {
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

// The Add operation, split off into a modal so the pane itself is view-only.
export function AddReceiverModal({
  title,
  channel,
  jobs,
  onClose,
  onCreated,
}: {
  title: string;
  channel: string;
  jobs: ReceiverJob[];
  onClose: () => void;
  onCreated: (token: string) => void;
}) {
  const t = useTranslations("channels");
  const router = useRouter();
  const search = useSearchParams();
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [lang, setLang] = useState<Locale>(DEFAULT_LOCALE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (creating || !jobId) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/channels/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, jobId, lang }),
      });
      // The route answers `{ webhook }` (POST /api/channels/webhooks), not a bare
      // token. Reading `p.token` therefore ALWAYS yielded undefined → onCreated("")
      // → no auto-select, so adding a second receiver silently left the setup guide
      // and the CV sim pointed at the OLD one: the recruiter copied the wrong
      // endpoint for the role they had just created. Typed against the record the
      // route actually returns so tsc pins the contract from now on.
      const p = (await r.json()) as { webhook?: ChannelWebhookRecord; error?: string };
      if (!r.ok) throw new Error(p.error);
      onCreated(p.webhook?.token ?? "");
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("add.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} size="md">
      {jobs.length === 0 ? (
        <p className="text-sm text-steel">
          {t("add.noJobs")}{" "}
          <button
            type="button"
            onClick={() => router.push(buildTabSwitchUrl("library", search.toString()))}
            className="focus-ring font-semibold text-coral hover:underline"
          >
            {t("add.noJobsCta")}
          </button>
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className={`mb-1 block ${META_LABEL}`}>{t("add.roleLabel")}</label>
            <SearchSelect
              value={jobId}
              onChange={setJobId}
              placeholder={t("add.rolePlaceholder")}
              options={jobs.map((j) => ({ value: j.id, label: j.title }))}
            />
          </div>
          <div>
            <span className={`mb-1 block ${META_LABEL}`}>{t("add.langLabel")}</span>
            <span className="flex items-center gap-1" role="group" aria-label={t("add.langLabel")}>
              {LOCALES.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLang(loc)}
                  aria-pressed={lang === loc}
                  className={`focus-ring rounded-full border px-2.5 py-0.5 text-sm font-semibold uppercase ${
                    lang === loc ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
                  }`}
                >
                  {loc}
                </button>
              ))}
            </span>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-coral">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 border-t border-stone-100 pt-3">
            <button type="button" onClick={onClose} className={`${BTN_SECONDARY} h-9 px-4 text-sm`}>
              {t("add.cancel")}
            </button>
            <button type="button" onClick={create} disabled={creating || !jobId} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
              {creating ? t("add.creating") : t("add.create")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

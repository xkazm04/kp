"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels.comms namespace on consolidation (matches the JD Ledger's own disable). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OutboxStatus } from "@/app/_lib/comms-status";
import { ResendButton } from "@/app/features/sub_dev/OutboxSection";
import { useLiveRefresh } from "@/app/features/live-refresh";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { Modal } from "@/app/_components/Modal";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_PRIMARY, CHIP_TOGGLE, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { isDeliverableAddress } from "@/app/_lib/comms-recipient";
import { labelize } from "@/app/_lib/format";
import { ColumnFilter } from "./filters";

// Communications, redesigned as a compact, column-filterable register (the JD
// Ledger pattern) instead of the old expand-in-place card list: one row per
// message, filter by channel / role / name, click a row to read the full body and
// resend a dead letter. Self-fetching so either prototype variant can just drop it
// in. (Native <select> filters are round-1 — a themed dropdown is a later upgrade.)

type Message = {
  id: string;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  kind: string | null;
  channel: string | null;
  status: OutboxStatus;
  ref: string | null;
  createdAt: string;
  recovered?: boolean;
  recoveredAt?: string | null;
  deliverable?: boolean;
  bounced?: boolean;
  bouncedAt?: string | null;
  bounceDetail?: string | null;
  /** A relay receipt that matched no send of ours (see comms-view.ts). */
  orphaned?: boolean;
};
type RefInfo = { label: string; jobTitle: string | null };

// A dead letter (failed, not yet recovered by a later resend), a sent row the relay
// later bounced, or an unmatched relay receipt — all three need the recruiter (or the
// integrator) to chase.
const isActionable = (m: Message) =>
  (m.status === "failed" && !m.recovered) || Boolean(m.bounced) || Boolean(m.orphaned);

// `orphanLabel` is threaded in (not hardcoded like its siblings) because it is NEW
// copy — the surrounding literals are prototype-stage and get localized wholesale in a
// later pass; anything added now goes through next-intl from the start.
function statusTone(m: Message, orphanLabel: string): { tone: BadgeTone; label: string } {
  if (m.orphaned) return { tone: "caution", label: orphanLabel };
  if (m.bounced) return { tone: "critical", label: "Bounced" };
  if (m.status === "failed") return m.recovered ? { tone: "positive", label: "Recovered" } : { tone: "critical", label: "Failed" };
  if (m.status === "sent") return { tone: "positive", label: "Sent" };
  if (m.status === "queued") return { tone: "info", label: "Queued" };
  return { tone: "neutral", label: labelize(m.status) };
}

const PAGE_SIZE = 40;

// A bounced message is a `sent` row the relay later rejected — resending it to the
// SAME address just bounces again, so this control asks for a corrected email and
// posts it to the resend route. It's the in-app action a bounced row was missing:
// `isActionable` counts bounces (red row, "chase" toggle) but the modal used to gate
// resend on `status === "failed"` only, leaving the loudest state a dead end (#3).
function BouncedResend({ id, defaultRecipient, onResent }: { id: string; defaultRecipient: string | null; onResent: () => void }) {
  const t = useTranslations("channels.comms");
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const valid = isDeliverableAddress(recipient.trim());
  const resend = async () => {
    if (state === "busy" || state === "done" || !valid) return;
    setState("busy");
    try {
      const r = await fetch(`/api/comms/${encodeURIComponent(id)}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: recipient.trim() }),
      });
      if (!r.ok) throw new Error();
      setState("done");
      onResent();
    } catch {
      setState("error");
    }
  };
  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50/60 p-3">
      <p className="text-xs text-red-800">{t("bouncedResendHint")}</p>
      <label className="block">
        <span className={`mb-1 block ${META_LABEL}`}>{t("bouncedRecipientLabel")}</span>
        <input
          type="email"
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            if (state !== "idle") setState("idle");
          }}
          placeholder={t("bouncedRecipientPlaceholder")}
          className={`${FIELD} w-full text-sm`}
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-steel" role={state === "error" ? "alert" : undefined}>
          {state === "error" ? t("resendFailed") : recipient.trim() && !valid ? t("bouncedResendInvalid") : ""}
        </span>
        <button
          type="button"
          onClick={resend}
          disabled={!valid || state === "busy" || state === "done"}
          className={`${BTN_PRIMARY} h-8 px-3 text-sm`}
        >
          {state === "done" ? t("resent") : state === "busy" ? t("resending") : t("resend")}
        </button>
      </div>
    </div>
  );
}

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
  // Status column filter reads the same as the column it filters.
  const orphanLabel = t("orphanBadge");
  const statuses = useMemo(
    () => [...new Set((messages ?? []).map((m) => statusTone(m, orphanLabel).label))].sort(),
    [messages, orphanLabel]
  );

  if (error) {
    return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{t("loadFailed")}</p>;
  }
  if (messages === null) {
    return (
      <div className="space-y-2" role="status" aria-label={t("loading")}>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
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
      (!statusFilter || statusTone(m, orphanLabel).label === statusFilter) &&
      matchesQuery(m)
  );
  const shown = filtered.slice(0, visibleCount);
  const open = openId ? messages.find((m) => m.id === openId) ?? null : null;

  return (
    <div className="space-y-3">
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
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
          <Inbox size={22} className="text-steel" aria-hidden />
          <p className="text-sm text-steel">{t("empty")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-stone-200 bg-paper/60">
                <th className="px-3 py-2">
                  <ColumnFilter title="Name" mode="search" value={nameQuery} onChange={setNameQuery} />
                </th>
                <th className="px-3 py-2">
                  <ColumnFilter title="Role" value={roleFilter} onChange={setRoleFilter} options={roles.map((r) => ({ value: r, label: r }))} />
                </th>
                <th className="px-3 py-2">
                  <ColumnFilter title="Channel" value={channelFilter} onChange={setChannelFilter} options={channels.map((c) => ({ value: c, label: labelize(c) }))} />
                </th>
                <th className="px-3 py-2">
                  <ColumnFilter title="Type" value={kindFilter} onChange={setKindFilter} options={kinds.map((k) => ({ value: k, label: labelize(k) }))} />
                </th>
                <th className="px-3 py-2">
                  <ColumnFilter title="Status" value={statusFilter} onChange={setStatusFilter} options={statuses.map((s) => ({ value: s, label: s }))} />
                </th>
                <th className={`px-3 py-2 ${META_LABEL}`}>Sent</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const st = statusTone(m, orphanLabel);
                // An unmatched receipt has no candidate address by construction
                // ("(relay callback)"), so the no-address warning is noise on it.
                const unaddressable = relayConfigured && m.deliverable === false && !m.orphaned;
                return (
                  <tr
                    key={m.id}
                    onClick={() => setOpenId(m.id)}
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
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-steel">{new Date(m.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
        <Modal title={nameOf(open)} subtitle={roleOf(open) ?? open.recipient ?? undefined} onClose={() => setOpenId(null)} size="lg">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge {...statusTone(open, orphanLabel)} />
              {open.kind ? <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold uppercase text-steel">{labelize(open.kind)}</span> : null}
              {open.channel ? <span className="text-xs text-steel">via {labelize(open.channel)}</span> : null}
              <span className="ml-auto text-xs text-steel">{new Date(open.createdAt).toLocaleString()}</span>
            </div>
            {open.orphaned ? (
              <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                {t("orphanHint")}
              </p>
            ) : null}
            {open.bounced ? (
              <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-800">
                <AlertTriangle size={12} aria-hidden />
                {t("bouncedAt", { time: open.bouncedAt ? new Date(open.bouncedAt).toLocaleString() : "—", detail: open.bounceDetail ?? "—" })}
              </p>
            ) : null}
            {open.subject ? <p className="font-semibold text-ink">{open.subject}</p> : null}
            {open.body ? (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-stone-200 bg-paper/50 p-3 font-sans text-sm leading-5 text-steel">
                {open.body}
              </pre>
            ) : (
              <p className="text-sm italic text-steel">{t("empty")}</p>
            )}
            {open.bounced ? (
              <BouncedResend id={open.id} defaultRecipient={open.recipient} onResent={load} />
            ) : open.status === "failed" && !open.recovered ? (
              <ResendButton id={open.id} onResent={load} />
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

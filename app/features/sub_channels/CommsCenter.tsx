"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, MailOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OutboxStatus } from "@/app/_lib/comms-status";
import { ResendButton } from "@/app/features/sub_dev/OutboxSection";
import { useLiveRefresh } from "@/app/features/live-refresh";

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
  /** Server-derived: a NEWER same-(ref,kind) row reached sent/queued, so this
   *  dead-letter is no longer actionable (the failed row stays as audit). */
  recovered?: boolean;
  recoveredAt?: string | null;
};
type RefInfo = { label: string; jobTitle: string | null };

const STATUS_STYLE: Record<OutboxStatus, string> = {
  queued: "bg-stone-100 text-steel",
  sent: "bg-moss/15 text-moss",
  failed: "bg-red-50 text-red-700",
};

// Initial page; "Show more" reveals another PAGE_SIZE. The list used to hard-slice 60
// with no "showing X of N" and no way to reach older rows — they vanished silently.
const PAGE_SIZE = 60;

// W6-2 (SIM1) — the recruiter-facing Comms Center. Every candidate-facing
// message (acknowledgement, outreach, rejection, interview invite/confirmation/
// reminder, offer, onboarding) was recorded with an entry ref but visible only
// in the Dev tab's display-only table: no body, no candidate link, no filter,
// no recovery. This panel lives where a recruiter thinks "candidate
// communications": failed-first with a loud dead-letter count, full message
// body on expand, and the W6-1 resend on failed rows.
export function CommsCenter() {
  const t = useTranslations("channels.comms");
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [refs, setRefs] = useState<Record<string, RefInfo>>({});
  const [error, setError] = useState(false);
  const [failedOnly, setFailedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(() => {
    fetch("/api/comms")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => {
        setMessages((p.messages as Message[]) ?? []);
        setRefs((p.entries as Record<string, RefInfo>) ?? {});
        setError(false);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // Sim/automation comms and Dev-tab resends arrive without a remount — follow
  // the rest of the tab (ChannelsTab) onto the shared data-changed channel.
  useLiveRefresh(load);

  if (error) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
        <p className="text-sm text-red-700">{t("loadFailed")}</p>
      </div>
    );
  }
  if (messages === null) {
    return <div role="status" aria-label={t("loading")} className="h-24 animate-pulse rounded-lg bg-stone-100" />;
  }

  // A recovered dead-letter (successful resend exists) is audit, not an alarm:
  // it leaves the count, the pin and the failed-only filter, so the badge again
  // answers "is anything STILL broken?".
  const isActionable = (m: Message) => m.status === "failed" && !m.recovered;
  const failedCount = messages.filter(isActionable).length;
  // The kinds actually present — drives the filter dropdown.
  const kinds = [...new Set(messages.map((m) => m.kind).filter((k): k is string => Boolean(k)))].sort();
  const needle = query.trim().toLowerCase();
  const matchesQuery = (m: Message) => {
    if (!needle) return true;
    const who = m.ref ? refs[m.ref] : undefined;
    return (
      (who?.label ?? "").toLowerCase().includes(needle) ||
      (m.recipient ?? "").toLowerCase().includes(needle) ||
      (m.subject ?? "").toLowerCase().includes(needle)
    );
  };
  // Dead letters first (they need action), then newest-first within each group.
  const sorted = [...messages].sort((a, b) =>
    isActionable(a) && !isActionable(b) ? -1 : isActionable(b) && !isActionable(a) ? 1 : 0
  );
  const filtered = sorted.filter(
    (m) => (!failedOnly || isActionable(m)) && (!kindFilter || m.kind === kindFilter) && matchesQuery(m)
  );
  const shown = filtered.slice(0, visibleCount);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
          <MailOpen size={16} className="text-coral" aria-hidden /> {t("title")}
        </h3>
        <span className="text-sm text-steel">{t("count", { count: messages.length })}</span>
        {failedCount > 0 ? (
          <button
            type="button"
            onClick={() => setFailedOnly((f) => !f)}
            aria-pressed={failedOnly}
            className={`focus-ring inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${
              failedOnly ? "bg-red-600 text-white" : "bg-red-50 text-red-700"
            }`}
          >
            <AlertTriangle size={12} aria-hidden /> {t("deadLetters", { count: failedCount })}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-steel">{t("intro")}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="focus-ring min-w-[12rem] flex-1 rounded-md border border-stone-200 px-2.5 py-1 text-sm"
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          aria-label={t("kindAll")}
          className="focus-ring rounded-md border border-stone-200 px-2 py-1 text-sm text-ink"
        >
          <option value="">{t("kindAll")}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-stone-300 bg-paper/50 p-4 text-sm text-steel">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {shown.map((m) => {
            const who = m.ref ? refs[m.ref] : undefined;
            return (
              <li key={m.id} className={`rounded-md border px-3 py-1.5 ${isActionable(m) ? "border-red-200 bg-red-50/50" : "border-stone-100 bg-paper/40"}`}>
                <details>
                  <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-semibold text-ink">{who?.label ?? m.recipient ?? "—"}</span>
                    {who?.jobTitle ? <span className="text-steel">· {who.jobTitle}</span> : null}
                    <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs font-semibold uppercase text-steel">
                      {(m.kind ?? "").replace(/_/g, " ")}
                    </span>
                    {m.status === "failed" && m.recovered ? (
                      <span className="rounded-full bg-moss/10 px-1.5 py-0.5 text-xs font-semibold uppercase text-moss">
                        {t("recovered")}
                      </span>
                    ) : (
                      <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLE[m.status]}`}>
                        {m.status === "queued" ? (m.channel ?? m.status) : m.status}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-steel">{new Date(m.createdAt).toLocaleString()}</span>
                      {m.status === "failed" ? (
                        m.recovered ? (
                          <span className="text-xs text-moss">
                            {t("recoveredAt", { time: m.recoveredAt ? new Date(m.recoveredAt).toLocaleString() : "—" })}
                          </span>
                        ) : (
                          <ResendButton id={m.id} onResent={load} compact />
                        )
                      ) : null}
                    </span>
                  </summary>
                  <div className="mt-1.5 border-t border-stone-100 pt-1.5 text-sm">
                    {m.subject ? <p className="font-semibold text-ink">{m.subject}</p> : null}
                    {m.body ? <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-5 text-steel">{m.body}</pre> : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > shown.length ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-steel">
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
    </div>
  );
}

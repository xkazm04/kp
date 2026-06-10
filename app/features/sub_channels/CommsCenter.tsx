"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, MailOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OutboxStatus } from "@/app/_lib/comms-status";
import { ResendButton } from "@/app/features/sub_dev/OutboxSection";

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
};
type RefInfo = { label: string; jobTitle: string | null };

const STATUS_STYLE: Record<OutboxStatus, string> = {
  queued: "bg-stone-100 text-steel",
  sent: "bg-moss/15 text-moss",
  failed: "bg-red-50 text-red-700",
};

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

  const failedCount = messages.filter((m) => m.status === "failed").length;
  // Dead letters first (they need action), then newest-first within each group.
  const sorted = [...messages].sort((a, b) =>
    a.status === "failed" && b.status !== "failed" ? -1 : b.status === "failed" && a.status !== "failed" ? 1 : 0
  );
  const visible = failedOnly ? sorted.filter((m) => m.status === "failed") : sorted;

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

      {visible.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-stone-300 bg-paper/50 p-4 text-sm text-steel">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {visible.slice(0, 60).map((m) => {
            const who = m.ref ? refs[m.ref] : undefined;
            return (
              <li key={m.id} className={`rounded-md border px-3 py-1.5 ${m.status === "failed" ? "border-red-200 bg-red-50/50" : "border-stone-100 bg-paper/40"}`}>
                <details>
                  <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-semibold text-ink">{who?.label ?? m.recipient ?? "—"}</span>
                    {who?.jobTitle ? <span className="text-steel">· {who.jobTitle}</span> : null}
                    <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs font-semibold uppercase text-steel">
                      {(m.kind ?? "").replace(/_/g, " ")}
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLE[m.status]}`}>
                      {m.status === "queued" ? (m.channel ?? m.status) : m.status}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-steel">{new Date(m.createdAt).toLocaleString()}</span>
                      {m.status === "failed" ? <ResendButton id={m.id} onResent={load} compact /> : null}
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
    </div>
  );
}

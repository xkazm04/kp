"use client";

// The "needs attention" section of InviteLifecyclePanel: candidate proposed-
// times escalations and needs_reconcile / needs_more_slots flags. Split out of
// ScheduleInviteLifecyclePanel.tsx to keep the panel file under the 200-line
// cap.

import { AlertTriangle, Wrench } from "lucide-react";
import type { useTranslations } from "next-intl";
import { hasPendingProposals } from "./scheduleInviteLifecycleBuckets";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { ArmedAction } from "./useScheduleInviteLifecycle";

export function AttentionSection({
  attention,
  t,
  slotLabel,
  armed,
  setArmed,
  busy,
  runAction,
}: {
  attention: ScheduleInvite[];
  t: ReturnType<typeof useTranslations<"scheduleTab.lifecycle">>;
  slotLabel: (slotAt: string | null, slot?: string | null) => string;
  armed: ArmedAction | null;
  setArmed: (a: ArmedAction | null) => void;
  busy: string | null;
  runAction: (token: string, action: string, slotAt?: string) => Promise<boolean>;
}) {
  if (attention.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-red-700">
        <AlertTriangle size={13} aria-hidden /> {t("attention", { count: attention.length })}
      </p>
      <ul className="mt-1.5 space-y-1">
        {attention.map((i) => (
          <li key={i.id} className="rounded-md border border-red-200 bg-red-50/60 px-3 py-1.5 text-sm">
            <span className="font-semibold text-ink">{i.candidateLabel ?? "—"}</span>
            {i.jobTitle ? <span className="text-steel"> · {i.jobTitle}</span> : null}{" "}
            {hasPendingProposals(i) ? (
              // "Propose your own times" escalation: the candidate suggested times;
              // accept one (books via the collision-checked path) or decline all
              // (returns an honest "couldn't accommodate" state to the candidate).
              <>
                <span className="text-red-700">{t("proposedTimes")}</span>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("proposalsGroupAria")}>
                  {(i.proposals ?? []).map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      disabled={busy === i.token}
                      onClick={() => runAction(i.token, "accept_proposal", p.value)}
                      className="focus-ring rounded-md border border-moss/40 bg-moss/10 px-2 py-1 text-micro font-semibold text-moss hover:bg-moss/20 disabled:opacity-50"
                    >
                      {t("acceptProposal", { time: slotLabel(p.value, p.label) })}
                    </button>
                  ))}
                  {armed?.token === i.token && armed.action === "decline_proposals" ? (
                    <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("declineProposalsPrompt")}>
                      <span className="text-micro font-semibold text-red-700">{t("declineProposalsPrompt")}</span>
                      <button type="button" disabled={busy === i.token} onClick={() => runAction(i.token, "decline_proposals")} className="focus-ring rounded-md border border-red-300 bg-white px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                        {t("confirmAction")}
                      </button>
                      <button type="button" autoFocus onClick={() => setArmed(null)} className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100">
                        {t("cancel")}
                      </button>
                    </span>
                  ) : (
                    <button type="button" disabled={busy === i.token} onClick={() => setArmed({ token: i.token, action: "decline_proposals" })} className="focus-ring rounded-md border border-stone-200 px-2 py-1 text-micro font-semibold text-steel hover:border-red-300 hover:bg-red-50 disabled:opacity-50">
                      {t("declineProposals")}
                    </button>
                  )}
                </div>
              </>
            ) : (
            <span className="text-red-700">
              {i.needsMoreSlots ? t("needsMoreSlots") : t("needsReconcile", { reason: i.reconcileReason ?? "" })}
            </span>
            )}
            {/* Direction 2 — in-app repair for the drift the store surfaces but
                the recruiter previously could only read: resolve clears the flag
                (two-step) once the mismatch is handled. */}
            {i.needsReconcile && !hasPendingProposals(i) ? (
              <span className="mt-1 flex items-center gap-1.5">
                {armed?.token === i.token && armed.action === "resolve_reconcile" ? (
                  <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("resolvePrompt")}>
                    <span className="text-micro font-semibold text-red-700">{t("resolvePrompt")}</span>
                    <button type="button" disabled={busy === i.token} onClick={() => runAction(i.token, "resolve_reconcile")} className="focus-ring rounded-md border border-red-300 bg-white px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                      {t("confirmAction")}
                    </button>
                    <button type="button" autoFocus onClick={() => setArmed(null)} className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100">
                      {t("cancel")}
                    </button>
                  </span>
                ) : (
                  <button type="button" disabled={busy === i.token} onClick={() => setArmed({ token: i.token, action: "resolve_reconcile" })} className="focus-ring inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                    <Wrench size={12} aria-hidden /> {t("resolveReconcile")}
                  </button>
                )}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

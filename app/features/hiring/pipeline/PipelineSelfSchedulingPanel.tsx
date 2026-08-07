"use client";

// The drawer's self-scheduling link panel: create-link + the delivery-truth
// note. Split out of PipelineCandidateDrawer.tsx.

import { Calendar } from "lucide-react";
import { useTranslations } from "next-intl";
import { TokenLinkPanel, useTokenLink } from "./PipelineTokenLink";

type UseTokenLink = ReturnType<typeof useTokenLink>;

// REC-10 — same truth-language as the voice invite: `dispatched` only ever
// meant "an outbox row was recorded", which is not delivery when no relay is
// configured.
function deliveryClaimOf(data: Record<string, unknown>, legacyFlag: "delivered" | "dispatched"): "sent" | "queued" | "failed" {
  const d = data.delivery;
  if (d === "sent" || d === "queued" || d === "failed") return d;
  return data[legacyFlag] ? "queued" : "failed";
}

export function PipelineSelfSchedulingPanel({ entryId, sched }: { entryId: string; sched: UseTokenLink }) {
  const t = useTranslations("pipeline.drawer");
  return (
    <div className="rounded-md border border-stone-200 bg-white p-3">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <Calendar size={13} /> {t("selfScheduling")}
      </p>
      <p className="mt-1 text-sm text-steel">{t("selfSchedulingHelp")}</p>
      <button
        type="button"
        onClick={() => sched.create({ entryId })}
        disabled={sched.busy}
        className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
      >
        <Calendar size={13} className="text-coral" /> {sched.busy ? t("creating") : t("createSchedulingLink")}
      </button>
      {sched.err ? <p role="alert" className="mt-2 text-sm text-red-700">{sched.err}</p> : null}
      {sched.data ? (
        <div className="mt-2 space-y-1.5">
          <TokenLinkPanel link={sched} />
          {deliveryClaimOf(sched.data, "dispatched") === "sent" ? (
            <p className="text-sm text-moss">{t("schedInviteSent")}</p>
          ) : deliveryClaimOf(sched.data, "dispatched") === "queued" ? (
            <p className="text-sm text-steel">{t("schedInviteQueued")}</p>
          ) : (
            <p className="text-sm text-amber-700">{t("schedInviteNotSent")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

"use client";

// c6524f2f — one row of the cross-store timeline chapters (analysis /
// interview / invite / offer), merged into the drawer's history list. An
// analysis row deep-links to its saved report and carries the recruiter's
// disposition. Split out of PipelineCandidateDrawer.tsx.

import Link from "next/link";
import { Banknote, Calendar, FileText, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CandidateTimelineItem } from "@/app/_lib/candidate-timeline";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";

export function PipelineTimelineItemRow({ item }: { item: CandidateTimelineItem }) {
  const t = useTranslations("pipeline.drawer.timeline");
  const tDisposition = useTranslations("history.disposition");
  // REC-10 — with no delivery relay a dispatched invite is a terminal outbox
  // row, so the chapter reads "queued", not "sent" (null = unknown keeps the
  // optimistic label rather than accusing a configured relay).
  const relayConfigured = useDeliveryCapability();
  const Icon =
    item.kind === "analysis" ? FileText : item.kind === "interview" ? Phone : item.kind === "invite" ? Calendar : Banknote;
  const label = (() => {
    switch (item.kind) {
      case "analysis":
        return item.score != null ? t("analysis", { score: item.score }) : t("analysisNoScore");
      case "interview":
        return item.status === "completed" ? t("interviewCompleted") : t("interviewCreated");
      case "invite":
        switch (item.status) {
          case "confirmed":
            return `${t("inviteConfirmed")}${item.slot ? ` — ${item.slot}` : ""}`;
          // Terminal fates — the timeline stops lying about a dead link (the offer
          // branch already surfaces its own terminal states this way).
          case "declined":
            return t("inviteDeclined");
          case "no_show":
            return t("inviteNoShow");
          case "expired":
            return t("inviteExpired");
          // A candidate proposal awaiting the recruiter — a fact, not an action.
          case "proposed":
            return t("inviteProposed");
          default:
            return t(relayConfigured === false ? "inviteQueued" : "inviteSent");
        }
      case "offer":
        return item.status === "accepted" ? t("offerAccepted") : item.status === "declined" ? t("offerDeclined") : t("offerExtended");
      default:
        return item.kind;
    }
  })();
  const disposition =
    item.kind === "analysis" && item.disposition && ["advance", "hold", "pass"].includes(item.disposition)
      ? tDisposition(item.disposition as "advance" | "hold" | "pass")
      : null;
  return (
    <>
      <Icon size={13} className="mt-0.5 shrink-0 text-steel" aria-hidden />
      <span className="min-w-0 flex-1 text-ink">
        {label}
        {disposition ? (
          <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-meta font-semibold uppercase text-steel">
            {disposition}
          </span>
        ) : null}
        {/* Reduced-confidence linkage: analyses have no entry/candidate FK, so an
            analysis on a corpus-job entry (no JD slug to confirm identity) is
            matched by NAME alone and may belong to a same-named stranger. Say so
            honestly rather than presenting it as certainly this candidate's. */}
        {item.kind === "analysis" && item.labelOnly ? (
          <span
            className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-meta font-semibold uppercase text-amber-700"
            title={t("byNameHint")}
          >
            {t("byName")}
          </span>
        ) : null}
        {item.kind === "analysis" && item.slug ? (
          <Link
            href={`/history/${encodeURIComponent(item.slug)}`}
            className="focus-ring ml-1.5 font-semibold text-coral hover:underline"
          >
            {t("openReport")}
          </Link>
        ) : null}
      </span>
    </>
  );
}

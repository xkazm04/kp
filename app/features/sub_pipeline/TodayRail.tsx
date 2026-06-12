"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CalendarClock, FileText, Inbox, PartyPopper, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams, type WorkspaceTabId } from "@/app/features/tabs";
import { daysSince, type Entry } from "./PipelineTypes";

// 8f8f578d — the "Today" rail: candidate-driven work, narrated. The attention
// badges say HOW MANY need you; this rail says WHO and WHERE, on the landing
// surface, with one click to the surface where each queue is worked. Derived
// entirely from the board's already-loaded /api/pipeline entries — deliberately
// NOT from the public events feed, whose payload is anonymized to initials with
// no entry ids because that endpoint is reachable unauthenticated
// (pipeline-events-public.ts). Renders nothing when every queue is quiet.

const MAX_NAMES = 2;
const HIRED_WINDOW_DAYS = 7;

type RailRow = {
  key: string;
  Icon: typeof Inbox;
  iconCls: string;
  message: string;
  ctaLabel: string;
  // Either an in-board stage focus (onShow) or a cross-tab jump (tab).
  stage?: string;
  tab?: WorkspaceTabId;
};

// "Erika N., Marek B. +3" — full labels are fine here: this is the recruiter's
// own workspace rendering data the board below already shows.
function nameList(list: Entry[]): string {
  const names = list.slice(0, MAX_NAMES).map((e) => e.candidateLabel).join(", ");
  const rest = list.length - MAX_NAMES;
  return rest > 0 ? `${names} +${rest}` : names;
}

export function TodayRail({ entries, onShowStage }: { entries: Entry[]; onShowStage: (stage: string) => void }) {
  const t = useTranslations("pipeline.today");
  const router = useRouter();
  const search = useSearchParams();

  const active = entries.filter((e) => e.status === "active");
  const inbound = active.filter((e) => e.stage === "Accepted");
  const awaitingSlot = active.filter((e) => e.approvalKind === "calendar");
  const scorecards = active.filter((e) => e.approvalKind === "scorecard_review");
  const offerReviews = active.filter((e) => e.approvalKind === "offer_review");
  // Offers out with the candidate: sent (no approval pending), response pending.
  const offersOut = active.filter((e) => e.stage === "Offer" && !e.approvalKind);
  const hired = entries.filter(
    (e) => e.stage === "Hired" && (daysSince(e.stageChangedAt) ?? Infinity) <= HIRED_WINDOW_DAYS
  );

  const candidates: (RailRow | null)[] = [
    inbound.length > 0
      ? {
          key: "inbound",
          Icon: Inbox,
          iconCls: "text-coral",
          message: `${t("inbound", { count: inbound.length })} — ${nameList(inbound)}`,
          ctaLabel: t("showBoard"),
          stage: "Accepted",
        }
      : null,
    scorecards.length > 0
      ? {
          key: "scorecards",
          Icon: FileText,
          iconCls: "text-moss",
          message: `${t("scorecards", { count: scorecards.length })} — ${nameList(scorecards)}`,
          ctaLabel: t("openDecisions"),
          tab: "decisions",
        }
      : null,
    offerReviews.length > 0
      ? {
          key: "offerReviews",
          Icon: Send,
          iconCls: "text-coral",
          message: `${t("offerReviews", { count: offerReviews.length })} — ${nameList(offerReviews)}`,
          ctaLabel: t("openDecisions"),
          tab: "decisions",
        }
      : null,
    awaitingSlot.length > 0
      ? {
          key: "awaitingSlot",
          Icon: CalendarClock,
          iconCls: "text-steel",
          message: `${t("awaitingSlot", { count: awaitingSlot.length })} — ${nameList(awaitingSlot)}`,
          ctaLabel: t("openSchedule"),
          tab: "schedule",
        }
      : null,
    offersOut.length > 0
      ? {
          key: "offersOut",
          Icon: Send,
          iconCls: "text-steel",
          message: `${t("offersOut", { count: offersOut.length })} — ${nameList(offersOut)}`,
          ctaLabel: t("showBoard"),
          stage: "Offer",
        }
      : null,
    hired.length > 0
      ? {
          key: "hired",
          Icon: PartyPopper,
          iconCls: "text-moss",
          message: `${t("hired", { count: hired.length })} — ${nameList(hired)}`,
          ctaLabel: t("showBoard"),
          stage: "Hired",
        }
      : null,
  ];
  const rows = candidates.filter((r): r is RailRow => r !== null);

  if (rows.length === 0) return null;

  const go = (row: RailRow) => {
    if (row.stage) onShowStage(row.stage);
    else if (row.tab) router.push(buildUrl({ tab: row.tab, ...clearedTabScopedParams() }, search.toString()));
  };

  return (
    <section aria-label={t("eyebrow")} className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
      <ul className="mt-2 divide-y divide-stone-100">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
            <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
              <row.Icon size={14} className={`shrink-0 ${row.iconCls}`} aria-hidden />
              <span className="min-w-0 truncate">{row.message}</span>
            </span>
            <button
              type="button"
              onClick={() => go(row)}
              className="focus-ring inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-coral hover:underline"
            >
              {row.ctaLabel} <ArrowRight size={13} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

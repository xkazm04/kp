"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CalendarClock, FileText, Inbox, PartyPopper, Send, Sunrise } from "lucide-react";
import { useTranslations } from "next-intl";
import { PANEL } from "@/app/_components/ui/recipes";
import { Fade } from "./PipelineMotion";
import { buildUrl, clearedTabScopedParams, type WorkspaceTabId } from "@/app/features/shell/tabs";
import { isSimTitle } from "@/app/features/shell/simulation/constants";
import { daysSince, type Entry } from "@/app/features/shared/pipelineTypes";

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

  // gsim-l2-105 — the rail digests the recruiter's REAL work: rows the guided
  // demo wrote (job title carries the "(SIM)" marker) must never claim "hired
  // this week" or swell the queues her lead reads. The board below still renders
  // them — visibly marked — so the running sim keeps seeing its own rows.
  const real = entries.filter((e) => !isSimTitle(e.jobTitle));
  const active = real.filter((e) => e.status === "active");
  const inbound = active.filter((e) => e.stage === "Accepted");
  const awaitingSlot = active.filter((e) => e.approvalKind === "calendar");
  const scorecards = active.filter((e) => e.approvalKind === "scorecard_review");
  const offerReviews = active.filter((e) => e.approvalKind === "offer_review");
  // Offers out with the candidate: sent (no approval pending), response pending.
  const offersOut = active.filter((e) => e.stage === "Offer" && !e.approvalKind);
  const hired = real.filter(
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

  const go = (row: RailRow) => {
    if (row.stage) onShowStage(row.stage);
    else if (row.tab) router.push(buildUrl({ tab: row.tab, ...clearedTabScopedParams() }, search.toString()));
  };

  // Structurally the attention strip's sibling — and now typographically too: it
  // sits directly under it and says the same KIND of thing (a queue, who's in it,
  // where it's worked), so it was reading as a different, smaller-voiced kind of
  // content purely because its rows were text-sm against the strip's text-base and
  // its heading was a loose coral eyebrow rather than a ruled panel header. Same
  // panel, same ruled header, same row size; the icon color still distinguishes.
  // Self-hiding, so the presence animation lives here (see PipelineMotion).
  return (
    <Fade show={rows.length > 0}>
      <section aria-label={t("eyebrow")} className={`${PANEL} overflow-hidden`}>
        <h3 className="flex items-center gap-2 border-b border-stone-200 bg-paper px-4 py-2 text-meta uppercase tracking-wide text-steel">
          <Sunrise size={14} className="text-coral" aria-hidden />
          {t("eyebrow")}
        </h3>
        <ul className="divide-y divide-stone-200">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-base text-ink">
                <row.Icon size={15} className={`shrink-0 ${row.iconCls}`} aria-hidden />
                <span className="min-w-0 truncate">{row.message}</span>
              </span>
              <button
                type="button"
                onClick={() => go(row)}
                className="focus-ring inline-flex shrink-0 items-center gap-1 text-base font-semibold text-coral hover:underline"
              >
                {row.ctaLabel} <ArrowRight size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </Fade>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CalendarClock, FileText, Inbox, PartyPopper, Send, Sunrise } from "lucide-react";
import { useTranslations } from "next-intl";
import { PANEL } from "@/app/_components/ui/recipes";
import { Fade } from "./PipelineMotion";
import { buildUrl, clearedTabScopedParams, type WorkspaceTabId } from "@/app/features/shell/tabs";
import { type StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { deriveRailRows, type RailBucketKey } from "./pipelineBoardPopulation";

// 8f8f578d — the "Today" rail: candidate-driven work, narrated. The attention
// badges say HOW MANY need you; this rail says WHO and WHERE, on the landing
// surface, with one click to the surface where each queue is worked. Derived
// entirely from the board's already-loaded /api/pipeline entries — deliberately
// NOT from the public events feed, whose payload is anonymized to initials with
// no entry ids because that endpoint is reachable unauthenticated
// (pipeline-events-public.ts). Renders nothing when every queue is quiet.

const MAX_NAMES = 2;

type RailRow = {
  key: RailBucketKey;
  Icon: typeof Inbox;
  iconCls: string;
  message: string;
  ctaLabel: string;
  // Either an in-board stage focus (onShow) or a cross-tab jump (tab).
  stage?: string;
  tab?: WorkspaceTabId;
};

// Presentation per bucket. WHICH buckets exist and WHO is in them is
// pipelineBoardPopulation.deriveRailRows — the same module the stat header counts
// from, so the two can never again answer "who is live on this board" differently.
// Here it is only the glyph, the tone and which catalog sentence to render.
const BUCKET_STYLE: Record<RailBucketKey, { Icon: typeof Inbox; iconCls: string; ctaKey: "showBoard" | "openDecisions" | "openSchedule" }> = {
  inbound: { Icon: Inbox, iconCls: "text-coral", ctaKey: "showBoard" },
  scorecards: { Icon: FileText, iconCls: "text-moss", ctaKey: "openDecisions" },
  offerReviews: { Icon: Send, iconCls: "text-coral", ctaKey: "openDecisions" },
  awaitingSlot: { Icon: CalendarClock, iconCls: "text-steel", ctaKey: "openSchedule" },
  offersOut: { Icon: Send, iconCls: "text-steel", ctaKey: "showBoard" },
  hired: { Icon: PartyPopper, iconCls: "text-moss", ctaKey: "showBoard" },
};

// "Erika N., Marek B. +3" — full labels are fine here: this is the recruiter's
// own workspace rendering data the board below already shows.
function nameList(list: Entry[]): string {
  const names = list.slice(0, MAX_NAMES).map((e) => e.candidateLabel).join(", ");
  const rest = list.length - MAX_NAMES;
  return rest > 0 ? `${names} +${rest}` : names;
}

export function TodayRail({
  entries,
  axis,
  onShowStage,
}: {
  entries: Entry[];
  /** The workspace's resolved board axis, straight off the /api/pipeline payload
   *  the tab already holds — the rail asks stage questions by ROLE, never by name. */
  axis: readonly StageDef[];
  onShowStage: (stage: string) => void;
}) {
  const t = useTranslations("pipeline.today");
  const router = useRouter();
  const search = useSearchParams();

  // gsim-l2-105 / UAT KAT-L1-002 — WHO is in each queue is derived ONCE, in
  // pipelineBoardPopulation.ts: real (non-sim) rows only, live status only, stage
  // questions resolved by ROLE on this workspace's own axis. The stat header above
  // counts from the same module, so the rail can no longer name four people under a
  // header that claims fourteen.
  const rows: RailRow[] = deriveRailRows(entries, axis).map((b) => {
    const style = BUCKET_STYLE[b.key];
    return {
      key: b.key,
      Icon: style.Icon,
      iconCls: style.iconCls,
      message: `${t(b.key, { count: b.entries.length })} — ${nameList(b.entries)}`,
      ctaLabel: t(style.ctaKey),
      stage: b.stage,
      tab: b.tab,
    };
  });

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

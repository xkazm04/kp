"use client";

// The AI round's "Docket" layout (winner of the /prototype round, 2026-08-10)
// — three stations that mirror the funnel: Awaiting link → Out / live →
// Completed. Each station is a panel of compact cards; a completed card opens
// the compact evaluation preview (verdict + rubric dots) with the full
// transcript one click deeper. The stations make the bottleneck visible at a
// glance (a fat left column = links not going out; a fat middle = candidates
// sitting on unopened links).
import { FileSearch, Link2, Loader2, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { InterviewSessionSummary } from "@/app/_lib/db/interviews";
import type { SchedEntry } from "./ScheduleTypes";
import type { IvStatus } from "./useScheduleTab";
import type { EvalTarget } from "./ScheduleAiRound";

function Station({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className={`${PANEL_SUNKEN} flex min-h-48 flex-col p-3`}>
      <h4 className="text-meta uppercase tracking-wide text-steel">
        {title} <span className="text-coral">· {count}</span>
      </h4>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-stone-200 p-2 text-sm text-steel">{children}</p>;
}

export function ScheduleAiDocket({
  sessions,
  awaiting,
  interviews,
  generating,
  onGenerate,
  onPreview,
}: {
  sessions: InterviewSessionSummary[];
  awaiting: SchedEntry[];
  interviews: Record<string, IvStatus>;
  generating: string | null;
  onGenerate: (e: SchedEntry) => void;
  onPreview: (target: EvalTarget) => void;
}) {
  const t = useTranslations("scheduleTab.aiRound");
  const format = useFormatter();
  const enumLabel = useEnumLabel();
  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  // What the call cost, from the usage ledger the completion wrote. THREE states,
  // and the third is the one that had no way to be said before: a real 0 (a
  // self-hosted provider served it, so no per-minute credits were spent) is not the
  // same claim as `null` (no ledger row, or an unpriced provider), and rendering an
  // unknown as "$0.00" would tell a recruiter the priciest meter in the product is
  // free. Formatted in the reader's locale like every other number here.
  const cost = (usd: number | null) =>
    usd == null
      ? t("costUnknown")
      : usd === 0
        ? t("costFree")
        : format.number(usd, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  const out = sessions.filter((s) => s.status === "created" || s.status === "in_progress");
  const done = sessions.filter((s) => s.status === "completed");

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Station title={t("awaitingTitle")} count={awaiting.length}>
        {awaiting.length === 0 ? <EmptyNote>{t("awaitingEmpty")}</EmptyNote> : null}
        {awaiting.map((e) => (
          <div key={e.id} className="rounded-lg border border-stone-200 bg-white p-2.5 shadow-panel">
            <p className="truncate font-semibold text-ink">{e.candidateLabel}</p>
            <p className="truncate text-sm text-steel">{e.jobTitle ?? "—"}</p>
            <button
              type="button"
              disabled={generating === e.id}
              onClick={() => onGenerate(e)}
              className="focus-ring mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-coral text-sm font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
            >
              {generating === e.id ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
              {t("generate")}
            </button>
          </div>
        ))}
      </Station>

      <Station title={t("outTitle")} count={out.length}>
        {out.length === 0 ? <EmptyNote>{t("outEmpty")}</EmptyNote> : null}
        {out.map((s) => {
          const live = s.status === "in_progress" || (s.entryId ? interviews[s.entryId]?.status === "in_progress" : false);
          return (
            <div key={s.id} className="rounded-lg border border-stone-200 bg-white p-2.5 shadow-panel">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-semibold text-ink">{s.candidateLabel ?? "—"}</p>
                {live ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-coral/10 px-2 py-0.5 text-sm font-semibold text-coral">
                    <span className="relative flex h-1.5 w-1.5" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-coral opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-coral" />
                    </span>
                    {t("live")}
                  </span>
                ) : (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-sm font-semibold text-blue-700">{t("linkOut")}</span>
                )}
              </div>
              <p className="truncate text-sm text-steel">{s.jobTitle ?? "—"}</p>
              <p className="nums mt-1 text-sm text-steel">{t("sent", { when: when(s.createdAt) })}</p>
            </div>
          );
        })}
      </Station>

      <Station title={t("doneTitle")} count={done.length}>
        {done.length === 0 ? <EmptyNote>{t("doneEmpty")}</EmptyNote> : null}
        {done.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={!s.entryId || !s.hasTranscript}
            onClick={() => s.entryId && onPreview({ id: s.entryId, candidateLabel: s.candidateLabel ?? "—", jobTitle: s.jobTitle })}
            className="focus-ring block w-full rounded-lg border border-stone-200 bg-white p-2.5 text-left shadow-panel transition-colors hover:border-moss/50 disabled:opacity-60"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-semibold text-ink">{s.candidateLabel ?? "—"}</p>
              {s.recommendation ? (
                <Badge {...interviewRecommendationToken(s.recommendation)} label={enumLabel("recommendation", s.recommendation)} />
              ) : (
                <span className="text-sm text-steel">{t("noScorecard")}</span>
              )}
            </div>
            <p className="truncate text-sm text-steel">{s.jobTitle ?? "—"}</p>
            <p className="nums mt-1 flex items-center justify-between text-sm text-steel">
              <span>{when(s.endedAt)}</span>
              <span className="inline-flex items-center gap-1 font-semibold text-moss">
                <FileSearch size={12} aria-hidden /> {s.ratingsCount > 0 ? t("competencies", { count: s.ratingsCount }) : t("review")}
              </span>
            </p>
            {/* What this one interview cost, and who served it. The ledger has carried
                both since the completion wrote them; neither had ever reached the
                recruiter deciding whether to run the next one. */}
            <p className="nums mt-0.5 flex items-center justify-between text-meta text-steel">
              <span title={t("providerTitle")}>{enumLabel("voiceProvider", s.provider)}</span>
              <span title={t("costTitle")}>{cost(s.costUsd)}</span>
            </p>
          </button>
        ))}
      </Station>

      <p className="flex items-center gap-1.5 text-sm text-steel lg:col-span-3">
        <Sparkles size={12} className="text-coral" aria-hidden />
        {t("verdictNote")}
      </p>
    </div>
  );
}

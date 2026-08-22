"use client";

import { Check, History, RotateCcw, Send, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useAddToPipeline } from "@/app/_lib/useAddToPipeline";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useReachOut } from "@/app/_lib/useReachOut";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { EmptyState, SkippedCandidatesNote } from "./JobsShared";
import type { SkippedCandidate } from "./JobsTypes";
// Type-only import of the canonical wire row — erased at compile time, so it does
// NOT pull rediscover.ts's better-sqlite3 runtime into this client bundle.
import type { Rediscovered } from "@/app/_lib/rediscover";

const PRIOR_STYLE: Record<string, string> = {
  rejected: "bg-coral/10 text-coral",
  closed: "bg-dial-amber/20 text-ink",
  elsewhere: "bg-steel/10 text-steel",
};

export function RediscoverPanel({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const t = useTranslations("jobs.rediscover");
  // The shared "+{count} more" truncation line (match.card.moreCount) — the same
  // parameterized, plural-correct string the match cards and the pipeline board
  // already use for a cut list, borrowed rather than forked into a new key.
  const tMore = useTranslations("match.card");
  // Localized pipeline-stage name for the disclosed prior depth (canonical stage →
  // enums.stage, with graceful fallback — the recruiter-side enum-label helper).
  const enumLabel = useEnumLabel();
  const { data: body, error } = useJsonFetch<{
    rediscovered?: Rediscovered[];
    skipped?: SkippedCandidate[];
    // How many silver medalists cleared the bar BEYOND the ones returned —
    // rediscoverForJob slices at REDISCOVER_LIMIT (20) and reports the remainder.
    more?: number;
  }>(`/api/jobs/${encodeURIComponent(jobId)}/rediscover`, t("loadFailed"));
  const data = body ? body.rediscovered ?? [] : null;
  const skipped = body?.skipped ?? [];
  // The route has always shipped this and this panel has always dropped it, so a
  // pool with 35 qualifying past candidates rendered its top 20 and said nothing —
  // presenting a cut slice as "the past candidates who clear the bar for this role"
  // on the one surface whose promise is that nobody falls through the cracks.
  const more = typeof body?.more === "number" && body.more > 0 ? body.more : 0;
  const { add, added, adding, error: addError, announce } = useAddToPipeline(jobId, jobTitle, "sourcing");
  const { reach, reached, reaching, error: reachError, announce: reachAnnounce } = useReachOut(jobId, "sourcing");

  if (error) return <p className="text-base text-coral">{error}</p>;
  if (!data)
    // The rediscovery scan is a CLI sweep over the pool: reserve the result
    // list's shape quietly (no skeleton bars) with a short copy line, per
    // docs/design/loading-choreography.md.
    return (
      <div className="reveal-quiet min-h-[12rem] space-y-2" aria-busy="true">
        <p className="text-sm text-steel">{t("scanning")}</p>
      </div>
    );
  // The skipped note rides above the results regardless of whether any candidate
  // resurfaced — a malformed profile may be exactly why the list looks empty.
  if (data.length === 0) {
    return (
      <div>
        <SkippedCandidatesNote skipped={skipped} />
        <EmptyState
          icon={History}
          title={t("emptyTitle")}
          body={t("emptyBody")}
        />
      </div>
    );
  }

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {[announce, reachAnnounce].filter(Boolean).join(" ")}
      </p>
      <SkippedCandidatesNote skipped={skipped} />
      <p className="text-base text-steel">
        {t.rich("intro", {
          jobTitle,
          b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
        })}
      </p>
      <ul className="mt-3 space-y-2">
        {data.map((c) => {
          const err = addError(c.candidateId);
          const reachErr = reachError(c.candidateId);
          const input = { candidateId: c.candidateId, candidateLabel: c.label, archetype: c.archetype, matchScore: c.score };
          return (
            <li key={c.candidateId} className="flex items-start gap-3 rounded-md border border-stone-200 bg-white px-3 py-2">
              <span className="shrink-0"><ScoreBadge score={c.score} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-ink">{c.label}</p>
                <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-meta ${PRIOR_STYLE[c.prior.kind]}`}>
                  {c.prior.label}
                </span>
                {/* Why-now (UAT M5): the forward-looking rationale Jana needs — what
                    changed + why this role now — not just the backward chip + score.
                    Grounded in the real prior outcome, the deterministic fit, and the
                    open role; localized (unlike the legacy English prior.label). */}
                <p className="mt-1 text-sm leading-snug text-steel">
                  {t(`whyNow.${c.prior.kind}`, { jobTitle, score: c.score })}
                  {/* Disclose the prior depth when it influenced ordering — depth > 0
                      means the band-limited boost lifted this candidate (prior reached
                      Screened or deeper). `stage` is canonical there, so enums.stage
                      resolves it. Honest base score stays the number shown by ScoreBadge. */}
                  {c.prior.depth > 0
                    ? " " + t("whyNow.reached", { stage: enumLabel("stage", c.prior.stage) })
                    : ""}
                </p>
              </div>
              {reached(c.candidateId) ? (
                // Reaching out also pipelines them, so a reached candidate is a
                // single badge — no redundant add button.
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-moss">
                  <Check size={14} /> {t("reachedOut")}
                </span>
              ) : (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => reach(input)}
                      disabled={reaching(c.candidateId)}
                      title={reachErr ?? t("reachTitle")}
                      className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                        reachErr ? "border-coral/60 bg-coral/10 text-coral" : "border-coral/40 bg-coral/5 text-coral hover:bg-coral/10"
                      }`}
                    >
                      {reachErr ? <RotateCcw size={14} /> : <Send size={14} />}{" "}
                      {reaching(c.candidateId) ? t("reaching") : reachErr ? t("tryAgain") : t("reachOut")}
                    </button>
                    {added(c.candidateId) ? (
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-moss">
                        <Check size={14} /> {t("added")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => add(input)}
                        disabled={adding(c.candidateId)}
                        title={err ?? undefined}
                        className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                          err
                            ? "border-coral/50 bg-coral/5 text-coral hover:border-coral/70"
                            : "border-stone-200 text-ink hover:border-coral/40"
                        }`}
                      >
                        {err ? <RotateCcw size={14} className="text-coral" /> : <UserPlus size={14} className="text-coral" />}{" "}
                        {adding(c.candidateId) ? t("adding") : err ? t("tryAgain") : t("addToPipeline")}
                      </button>
                    )}
                  </div>
                  {err ? (
                    <span className="max-w-[12rem] text-right text-meta text-coral">{t("couldntAdd", { error: err })}</span>
                  ) : null}
                  {reachErr ? (
                    <span className="max-w-[12rem] text-right text-meta text-coral">{t("couldntReach", { error: reachErr })}</span>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <p className="mt-2 text-sm text-steel">{tMore("moreCount", { count: more })}</p>
      ) : null}
    </div>
  );
}

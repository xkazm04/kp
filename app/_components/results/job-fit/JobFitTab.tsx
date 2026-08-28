"use client";

import { AlertTriangle, BriefcaseBusiness } from "lucide-react";
import { useTranslations } from "next-intl";
import { Meter } from "@/app/_components/Meter";
import { ScoreDial } from "@/app/_components/ScoreDial";
import type { Analysis } from "@/app/_lib/schemas";
import { dedupe, dedupeBy } from "@/app/_lib/dedupe";
import { ListBlock } from "../shared";
import { SkillChips } from "./SkillChips";

type KeywordCoverage = NonNullable<Analysis["keywordCoverage"]>;

export function JobFitTab({ analysis }: { analysis: Analysis }) {
  const t = useTranslations("report");
  if (!analysis.jobFit) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <h3 className="font-serif text-h3 text-ink">{t("panel.jobFit")}</h3>
        <p className="mt-3 text-base leading-6 text-steel">{t("panel.jobFitPlaceholder")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <BriefcaseBusiness className="h-5 w-5 text-coral" aria-hidden />
                <h3 className="font-serif text-h3 text-ink">{t("panel.jobFit")}</h3>
              </div>
              <p className="mt-3 text-base leading-6 text-ink">{analysis.jobFit.summary}</p>
            </div>
            {/* jobFit.score is a standalone 0-100 role-fit scalar, NOT the
                experience+skills+… breakdown total — there is no FactorChart
                here to contradict, so the score-breakdown invariant
                (reconcileScoreTotal) does not apply to this dial. */}
            <ScoreDial score={analysis.jobFit.score} />
          </div>
          <div className="mt-4">
            <SkillChips
              matchingSkills={analysis.jobFit.matchingSkills}
              missingSkills={analysis.jobFit.missingSkills}
              evidence={analysis.evidenceTrace?.skills}
            />
          </div>
          {(analysis.jobFit.unprovenSkills?.length ?? 0) > 0 ? (
            <UnprovenSkillsBlock
              skills={analysis.jobFit.unprovenSkills ?? []}
              strength={analysis.jobFit.unprovenSkillStrength ?? {}}
              reason={analysis.jobFit.unprovenSkillReason ?? {}}
            />
          ) : null}
        </div>

        {analysis.keywordCoverage ? (
          <KeywordCoverageBlock coverage={analysis.keywordCoverage} />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <ListBlock
            title={t("panel.talkingPoints")}
            items={analysis.jobFit.interviewTalkingPoints}
            emptyHeadline={t("panel.talkingPointsEmpty")}
            emptyHint={t("panel.talkingPointsHint")}
          />
          <ListBlock
            title={t("panel.mustProve")}
            items={analysis.jobFit.mustProveEvidence}
            emptyHeadline={t("panel.mustProveEmpty")}
            emptyHint={t("panel.mustProveHint")}
          />
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">{t("panel.alignment")}</h3>
          <div className="mt-4 space-y-3 text-base leading-6 text-ink">
            <p>{analysis.jobFit.seniorityAlignment}</p>
            <p>{analysis.jobFit.roleAlignment}</p>
            <p>{analysis.jobFit.salaryAssessment}</p>
          </div>
          <div className="mt-4 rounded-md bg-limewash p-3 text-base leading-6 text-ink">{analysis.jobFit.negotiationAngle}</div>
        </div>
        <ListBlock
          title={t("panel.riskFlags")}
          items={analysis.jobFit.recruiterRiskFlags}
          emptyHeadline={t("panel.riskFlagsEmpty")}
          emptyHint={t("panel.riskFlagsHint")}
        />
        <ListBlock
          title={t("panel.cvRewrites")}
          items={analysis.jobFit.cvRewriteSuggestions}
          emptyHeadline={t("panel.cvRewritesEmpty")}
          emptyHint={t("panel.cvRewritesHint")}
        />
        {/* jobFit.recommendations was fully dead payload — the role-specific next
            steps the engine already produced. Same copyable ListBlock idiom;
            guarded so an empty list adds no chrome. */}
        {analysis.jobFit.recommendations.length > 0 ? (
          <ListBlock title={t("panel.recommendations")} items={analysis.jobFit.recommendations} />
        ) : null}
      </div>
    </div>
  );
}

// Claimed-but-UNPROVEN bucket for the analyze surface — the SHIPPED idiom from
// AnalysisSummaryModal (amber chips + a reason label), reusing the SAME
// decisions.summary vocabulary so the analyze and recruiter honesty surfaces never
// drift. The engine emits this deterministically (matching.score_job over the JD's
// DETECTED skills, each treated as a DEFAULTED must-have/prerequisite — a uniform
// assumption, not something the ad stated): it reclassifies a skill the LLM called
// "missing" as an ADJACENCY near-miss (a sibling/specialization) or a
// provenance-discounted claim. A prompt to probe, NEVER a second overall score —
// there is intentionally no number here, only chips, so the analyze surface gains
// honesty without ever showing a competing headline.
function UnprovenSkillsBlock({
  skills,
  strength,
  reason,
}: {
  skills: string[];
  strength: Record<string, number>;
  reason: Record<string, string>;
}) {
  // The unproven vocabulary lives in decisions.summary (first shipped there); reuse
  // it verbatim rather than forking the same six strings into the report namespace.
  const t = useTranslations("decisions.summary");
  // Map the reason code to its honest label key; an unknown/absent code degrades to
  // the neutral "claimed" label rather than asserting a distinction we can't back.
  const unprovenLabelKey = (
    r: string | undefined,
  ): "unprovenAdjacency" | "unprovenProvenance" | "unprovenBoth" | "unprovenClaimed" =>
    r === "adjacency" ? "unprovenAdjacency" : r === "provenance" ? "unprovenProvenance" : r === "both" ? "unprovenBoth" : "unprovenClaimed";
  return (
    <div className="mt-4">
      <p className="text-meta uppercase tracking-wide text-steel">{t("unprovenTitle")}</p>
      <p className="mt-0.5 text-sm text-steel">{t("unprovenHelp")}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {skills.map((s) => {
          const st = strength[s];
          return (
            <span
              key={`u-${s}`}
              className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-sm text-amber-800"
              title={st != null ? t("unprovenStrengthTitle", { pct: Math.round(st * 100) }) : undefined}
            >
              {s}
              <span className="rounded bg-amber-100 px-1 text-[10px] uppercase text-amber-800">{t(unprovenLabelKey(reason[s]))}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function KeywordCoverageBlock({ coverage }: { coverage: KeywordCoverage }) {
  const t = useTranslations("report");
  // LLM keyword lists routinely repeat a token; de-dupe so a keyword renders
  // once and its value can never collide as a React key.
  const hits = dedupeBy(coverage.hits, (hit) => hit.keyword);
  const missing = dedupe(coverage.missing);
  const overUsed = dedupe(coverage.overUsed);

  // "+N more" reflects entries the server-side display cap dropped (see the
  // caps in pipeline/jobfit/ats.py). It's measured against the raw list the
  // server sent — not the de-duped view — so the cap is never conflated with
  // client-side de-duping.
  const hitsHidden = hiddenByCap(coverage.hitsTotal, coverage.hits.length);
  const missingHidden = hiddenByCap(coverage.missingTotal, coverage.missing.length);
  const overUsedHidden = hiddenByCap(coverage.overUsedTotal, coverage.overUsed.length);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-serif text-h3 text-ink">{t("panel.keywordCoverage")}</h3>
        <span className="text-base font-semibold text-ink nums">
          {coverage.coveragePercent}%
        </span>
      </div>
      {/* Shared Meter (fixed "strong" tone — coverage is a more-is-better bar): gives
          progressbar a11y + reduced-motion that the old bespoke bar lacked. */}
      <Meter value={coverage.coveragePercent} tone="strong" className="mt-3" aria-label={t("panel.keywordCoverage")} />

      {hits.length ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {hits.map((hit, i) => (
              <KeywordRow key={`${hit.keyword}-${i}`} hit={hit} />
            ))}
          </div>
          <MoreIndicator count={hitsHidden} />
        </>
      ) : (
        <p className="mt-4 text-base leading-6 text-steel">{t("panel.noKeywords")}</p>
      )}

      {missing.length ? (
        <div className="mt-5">
          <p className="text-base font-semibold text-ink">{t("panel.keywordsMissing")}</p>
          <p className="mt-1 text-sm leading-5 text-steel">{t("panel.keywordsMissingHint")}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missing.map((keyword, i) => (
              <li
                key={`${keyword}-${i}`}
                className="rounded-full border border-coral/40 bg-red-50 px-3 py-1 text-sm font-semibold text-ink"
              >
                {keyword}
              </li>
            ))}
          </ul>
          <MoreIndicator count={missingHidden} />
        </div>
      ) : null}

      {overUsed.length ? (
        <div className="mt-5 rounded-md bg-paper p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-coral" aria-hidden />
            <p className="text-base font-semibold text-ink">{t("panel.keywordStuffing")}</p>
          </div>
          <p className="mt-1 text-sm leading-5 text-steel">{t("panel.keywordStuffingHint")}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {overUsed.map((keyword, i) => (
              <li
                key={`${keyword}-${i}`}
                className="rounded-full border border-stone-300 bg-white px-3 py-1 text-sm font-semibold text-ink"
              >
                {keyword}
              </li>
            ))}
          </ul>
          <MoreIndicator count={overUsedHidden} />
        </div>
      ) : null}
    </div>
  );
}

// Entries the server-side display cap dropped: total minus what was sent. A
// missing total (null/undefined) means the analysis predates total-tracking
// (see KeywordCoverage in pipeline/jobfit/models.py) — treat as "unknown" and
// show nothing rather than guess.
function hiddenByCap(total: number | null | undefined, shown: number): number {
  return total == null ? 0 : Math.max(0, total - shown);
}

// Renders a quiet "+N more" note so a capped list reads as capped, not complete.
function MoreIndicator({ count }: { count: number }) {
  const t = useTranslations("report");
  if (count <= 0) return null;
  return <p className="mt-2 text-sm text-steel">{t("panel.moreHidden", { count })}</p>;
}

// Chip color is keyed off the single server-computed `status` enum (so the legend,
// count, and swatch can never drift); the human label is looked up by the same enum
// from the localized catalog at render.
// `unknown` is a real fourth state, not a fallback for a missing case. `status` was
// added on 2026-06-01 and analyses recorded before it carry hits with none, so a
// legacy row must render as "coverage state unknown" rather than borrow another
// state's colour — guessing `missing` would invent a keyword gap the candidate does
// not have, which is worse than admitting the analysis predates the field.
type KeywordStatusKey = NonNullable<KeywordCoverage["hits"][number]["status"]> | "unknown";

const KEYWORD_STATUS_CLS: Record<KeywordStatusKey, string> = {
  matched: "border-moss/40 bg-moss/10 text-ink",
  missing: "border-coral/40 bg-red-50 text-ink",
  over_used: "border-dial-amber/50 bg-dial-amber/10 text-ink",
  unknown: "border-stone-200 bg-stone-50 text-steel",
};
const KEYWORD_STATUS_KEY: Record<KeywordStatusKey, string> = {
  matched: "panel.kwMatched",
  missing: "panel.kwMissing",
  over_used: "panel.kwOverUsed",
  unknown: "panel.kwUnknown",
};

function KeywordRow({ hit }: { hit: KeywordCoverage["hits"][number] }) {
  const t = useTranslations("report");
  const status: KeywordStatusKey = hit.status ?? "unknown";
  return (
    <div className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-base ${KEYWORD_STATUS_CLS[status]}`}>
      <span className="truncate font-medium">{hit.keyword}</span>
      <span className="shrink-0 text-sm font-semibold uppercase tracking-wide text-steel">
        {t("panel.kwJdCv", { jd: hit.inJd, cv: hit.inCv })} · {t(KEYWORD_STATUS_KEY[status] as Parameters<typeof t>[0])}
      </span>
    </div>
  );
}

"use client";

// Matched/unproven/missing skill chip row (with the expand/collapse "+N more"
// control), split out of MatchCard.tsx.
//
// match-card-shows-the-unproven-middle: the payload has carried the
// claimed-but-UNPROVEN bucket (`unprovenSkills` + strength + reason) since round 7,
// and Decisions (DecisionsAnalysisParts.UnprovenChips) and the job-fit report
// (JobFitTab.UnprovenSkillsBlock) both render it — but the match CARD, the surface a
// recruiter picks interviewees on, showed only matched and missing. The middle bucket
// is precisely what an interview is for, so it now rides the same chip row: amber,
// reason-stamped, strength in the tooltip. Semantics (and the six catalog strings)
// are copied from those two, not the markup.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { provLabel } from "@/app/features/shared/matchTypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

const MATCHED_CAP = 8;
const UNPROVEN_CAP = 5;
const MISSING_CAP = 6;

// The unproven vocabulary lives in `decisions.summary` (where it first shipped); reuse
// it verbatim rather than forking the same strings into `match`. An unknown/absent
// reason code degrades to the neutral "claimed" label rather than asserting a
// distinction we cannot back.
export function unprovenLabelKey(
  reason: string | undefined,
): "unprovenAdjacency" | "unprovenProvenance" | "unprovenBoth" | "unprovenClaimed" {
  return reason === "adjacency"
    ? "unprovenAdjacency"
    : reason === "provenance"
      ? "unprovenProvenance"
      : reason === "both"
        ? "unprovenBoth"
        : "unprovenClaimed";
}

export function MatchCardSkillChips({
  matchedSkills,
  missingSkills,
  matchedSkillProvenance,
  matchedSkillStrength,
  unprovenSkills,
  unprovenSkillStrength,
  unprovenSkillReason,
  early,
}: {
  matchedSkills?: string[];
  missingSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  matchedSkillStrength?: Record<string, number>;
  // Additive & optional: an older analysis without the bucket renders exactly as
  // before (absent = no amber chips at all).
  unprovenSkills?: string[];
  unprovenSkillStrength?: Record<string, number>;
  unprovenSkillReason?: Record<string, string>;
  early: boolean;
}) {
  const t = useTranslations("match");
  const tu = useTranslations("decisions.summary");
  const enumLabel = useEnumLabel();
  const [skillsExpanded, setSkillsExpanded] = useState(false);

  const matched = matchedSkills ?? [];
  const missing = missingSkills ?? [];
  const unproven = unprovenSkills ?? [];
  const matchedShown = skillsExpanded ? matched : matched.slice(0, MATCHED_CAP);
  const unprovenShown = skillsExpanded ? unproven : unproven.slice(0, UNPROVEN_CAP);
  const missingShown = skillsExpanded ? missing : missing.slice(0, MISSING_CAP);
  const hidden =
    Math.max(0, matched.length - matchedShown.length) +
    Math.max(0, unproven.length - unprovenShown.length) +
    Math.max(0, missing.length - missingShown.length);

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {matchedShown.map((s) => {
        const pl = early ? provLabel((matchedSkillProvenance ?? {})[s] ?? "self_declared") : null;
        // A 0.5–<1.0 hit is a taxonomy/sibling or provenance-discounted PARTIAL
        // match, not proven exact possession — mark it so "matched: Kubernetes"
        // isn't read as verified Kubernetes experience.
        const strength = (matchedSkillStrength ?? {})[s];
        const partial = typeof strength === "number" && strength < 1;
        return (
          <span
            key={`m-${s}`}
            title={partial ? t("card.partialTitle", { pct: Math.round(strength * 100) }) : undefined}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-green-700 ${partial ? "bg-green-50/60 ring-1 ring-inset ring-green-600/30" : "bg-green-50"}`}
          >
            {partial ? `~ ${s}` : s}
            {pl ? <span className={`rounded px-1 text-sm uppercase ${pl.tone}`}>{enumLabel("provenance", pl.key)}</span> : null}
          </span>
        );
      })}
      {unprovenShown.map((s) => {
        const st = (unprovenSkillStrength ?? {})[s];
        // Two facts, one chip: the reason badge says WHY it is unproven, the
        // tooltip carries the partial strength and the "probe, don't count it"
        // framing the report block states in prose.
        const strengthTitle = st != null ? tu("unprovenStrengthTitle", { pct: Math.round(st * 100) }) : null;
        return (
          <span
            key={`u-${s}`}
            className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-sm text-amber-800"
            title={`${tu("unprovenTitle")} — ${tu("unprovenHelp")}${strengthTitle ? ` (${strengthTitle})` : ""}`}
          >
            {`? ${s}`}
            <span className="rounded bg-amber-100 px-1 text-sm uppercase text-amber-800">
              {tu(unprovenLabelKey((unprovenSkillReason ?? {})[s]))}
            </span>
          </span>
        );
      })}
      {missingShown.map((s) => (
        <span
          key={`x-${s}`}
          className="rounded-md bg-red-50 px-1.5 py-0.5 text-sm text-red-700"
          title={early ? t("card.missingTitleEarly") : t("card.missingTitle")}
        >
          {`✗ ${s}`}
        </span>
      ))}
      {hidden > 0 || skillsExpanded ? (
        <button
          type="button"
          onClick={() => setSkillsExpanded((v) => !v)}
          className="focus-ring rounded-md bg-stone-100 px-1.5 py-0.5 text-sm font-semibold text-steel hover:bg-stone-200"
        >
          {skillsExpanded ? t("card.showLess") : t("card.moreCount", { count: hidden })}
        </button>
      ) : null}
    </div>
  );
}

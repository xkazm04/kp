"use client";

// Matched/missing skill chip row (with the expand/collapse "+N more" control),
// split out of MatchCard.tsx.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { provLabel } from "@/app/features/shared/matchTypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

const MATCHED_CAP = 8;
const MISSING_CAP = 6;

export function MatchCardSkillChips({
  matchedSkills,
  missingSkills,
  matchedSkillProvenance,
  matchedSkillStrength,
  early,
}: {
  matchedSkills?: string[];
  missingSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  matchedSkillStrength?: Record<string, number>;
  early: boolean;
}) {
  const t = useTranslations("match");
  const enumLabel = useEnumLabel();
  const [skillsExpanded, setSkillsExpanded] = useState(false);

  const matched = matchedSkills ?? [];
  const missing = missingSkills ?? [];
  const matchedShown = skillsExpanded ? matched : matched.slice(0, MATCHED_CAP);
  const missingShown = skillsExpanded ? missing : missing.slice(0, MISSING_CAP);
  const hidden = Math.max(0, matched.length - matchedShown.length) + Math.max(0, missing.length - missingShown.length);

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

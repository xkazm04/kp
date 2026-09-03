"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { dedupe } from "@/app/_lib/dedupe";

// IMPORTANT: `missingSkills` is a flat, model-emitted list (schemas.generated.ts:
// `z.array(z.string())`) with NO guaranteed criticality ordering. These tiers are
// therefore a *prominence/position* split (first 3 / next 5 / rest), NOT a
// must-have vs nice-to-have classification. The user-facing labels are
// deliberately position-neutral ("Top gaps" / "Other gaps" / "Minor gaps") so we
// don't brand an arbitrarily-first gap as a "deal-breaker". If/when the engine
// emits an explicit per-skill weight, switch to that instead of slicing.
const TOP_GAP_LIMIT = 3;
const OTHER_GAP_LIMIT = 5;

type Tier = "must" | "nice" | "bonus";

// Tier label keys (localized at render); the English literals moved to messages.report.panel.
const TIER_LABEL_KEY: Record<Tier, string> = {
  must: "panel.tierMust",
  nice: "panel.tierNice",
  bonus: "panel.tierBonus",
};

// A NEUTRAL emphasis scale, not a severity scale. `missingSkills` carries no
// model-emitted criticality (see the note above), so a coral "danger" must-tier
// over-claimed importance the engine never expressed. These tiers now read as a
// descending PROMINENCE ramp in the ink→stone→paper neutrals: top-listed gaps sit
// darkest (ink), the rest fade back — position, not deal-breaker.
const TIER_BADGE_PALETTES: Record<Tier, string> = {
  must: "border-ink/20 bg-ink/5 text-ink",
  nice: "border-stone-300 bg-stone-100 text-steel",
  bonus: "border-stone-200 bg-paper text-steel",
};

const TIER_CHIP_PALETTES: Record<Tier, string> = {
  must: "bg-ink/5 text-ink border border-ink/10",
  nice: "bg-stone-100 text-steel",
  bonus: "bg-paper text-steel border border-stone-200",
};

function splitIntoTiers(skills: string[]): Record<Tier, string[]> {
  return {
    must: skills.slice(0, TOP_GAP_LIMIT),
    nice: skills.slice(TOP_GAP_LIMIT, TOP_GAP_LIMIT + OTHER_GAP_LIMIT),
    bonus: skills.slice(TOP_GAP_LIMIT + OTHER_GAP_LIMIT),
  };
}

function MissingChip({ label, tier }: { label: string; tier: Tier }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${TIER_CHIP_PALETTES[tier]}`}
    >
      <X className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

function TierBlock({ tier, skills }: { tier: Tier; skills: string[] }) {
  const t = useTranslations("report");
  if (!skills.length) return null;
  const count = skills.length;
  // Coaching line per tier (count-aware), localized.
  const coaching =
    tier === "must"
      ? count === 1
        ? t("panel.coachMustOne")
        : t("panel.coachMustMany", { count })
      : tier === "nice"
        ? count === 1
          ? t("panel.coachNiceOne")
          : t("panel.coachNiceMany")
        : t("panel.coachBonus");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-meta font-medium ${TIER_BADGE_PALETTES[tier]}`}
        >
          {t(TIER_LABEL_KEY[tier] as Parameters<typeof t>[0])}
          <span className="opacity-60">·{skills.length}</span>
        </span>
      </div>
      <p className="text-sm leading-5 text-steel">{coaching}</p>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {skills.map((skill, i) => (
          <MissingChip key={`${skill}-${i}`} label={skill} tier={tier} />
        ))}
      </div>
    </div>
  );
}

export function MissingSkillsTiers({ skills }: { skills: string[] }) {
  const t = useTranslations("report");
  const [expanded, setExpanded] = useState(false);
  // De-dupe before tiering so a skill repeated in the model output can't appear
  // in two tiers (or twice in one) and can't collide as a chip key.
  const tiers = useMemo(() => splitIntoTiers(dedupe(skills)), [skills]);
  const collapsedCount = tiers.nice.length + tiers.bonus.length;

  return (
    <div className="rounded-md bg-paper p-3">
      <h4 className={META_LABEL}>{t("panel.missingSkills")}</h4>

      {skills.length === 0 ? (
        <p className="mt-2 text-sm leading-5 text-steel">{t("panel.missingSkillsCovered")}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {tiers.must.length > 0 ? (
            <TierBlock tier="must" skills={tiers.must} />
          ) : (
            <p className="text-sm leading-5 text-moss">{t("panel.noDealBreakers")}</p>
          )}

          {collapsedCount > 0 ? (
            <div className="space-y-3">
              {expanded ? (
                <>
                  <TierBlock tier="nice" skills={tiers.nice} />
                  <TierBlock tier="bonus" skills={tiers.bonus} />
                </>
              ) : null}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="focus-ring inline-flex items-center gap-1 rounded-md text-sm font-medium text-coral hover:underline"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" aria-hidden />
                    {t("panel.hideSofterGaps")}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" aria-hidden />
                    {t("panel.showMoreGaps", { count: collapsedCount })}
                  </>
                )}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

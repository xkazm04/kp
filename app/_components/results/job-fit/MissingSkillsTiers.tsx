"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import { dedupe } from "@/app/_lib/dedupe";

const MUST_HAVE_LIMIT = 3;
const NICE_TO_HAVE_LIMIT = 5;

type Tier = "must" | "nice" | "bonus";

const TIER_LABELS: Record<Tier, string> = {
  must: "Must have",
  nice: "Nice to have",
  bonus: "Bonus",
};

const TIER_BADGE_PALETTES: Record<Tier, string> = {
  must: "border-coral/40 bg-coral/10 text-coral",
  nice: "border-stone-300 bg-stone-100 text-ink",
  bonus: "border-stone-200 bg-paper text-steel",
};

const TIER_CHIP_PALETTES: Record<Tier, string> = {
  must: "bg-coral/10 text-coral",
  nice: "bg-stone-100 text-ink",
  bonus: "bg-paper text-steel border border-stone-200",
};

function coachingFor(tier: Tier, count: number): string {
  if (tier === "must") {
    return count === 1
      ? "This one is likely a deal-breaker — address it in your CV summary or top bullet today."
      : `${count} of these can be addressed in your CV summary or top bullets today.`;
  }
  if (tier === "nice") {
    return count === 1
      ? "Folding this into your skills line or a project bullet strengthens the match."
      : "Naming even one or two of these in your skills line strengthens the match.";
  }
  return "Preferred rather than required — only worth flagging if you genuinely have them.";
}

function splitIntoTiers(skills: string[]): Record<Tier, string[]> {
  return {
    must: skills.slice(0, MUST_HAVE_LIMIT),
    nice: skills.slice(MUST_HAVE_LIMIT, MUST_HAVE_LIMIT + NICE_TO_HAVE_LIMIT),
    bonus: skills.slice(MUST_HAVE_LIMIT + NICE_TO_HAVE_LIMIT),
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
  if (!skills.length) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-meta font-medium ${TIER_BADGE_PALETTES[tier]}`}
        >
          {TIER_LABELS[tier]}
          <span className="opacity-60">·{skills.length}</span>
        </span>
      </div>
      <p className="text-sm leading-5 text-steel">{coachingFor(tier, skills.length)}</p>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {skills.map((skill, i) => (
          <MissingChip key={`${skill}-${i}`} label={skill} tier={tier} />
        ))}
      </div>
    </div>
  );
}

export function MissingSkillsTiers({ skills }: { skills: string[] }) {
  const [expanded, setExpanded] = useState(false);
  // De-dupe before tiering so a skill repeated in the model output can't appear
  // in two tiers (or twice in one) and can't collide as a chip key.
  const tiers = useMemo(() => splitIntoTiers(dedupe(skills)), [skills]);
  const collapsedCount = tiers.nice.length + tiers.bonus.length;

  return (
    <div className="rounded-md bg-paper p-3">
      <h4 className="text-meta uppercase text-steel">Missing Skills</h4>

      {skills.length === 0 ? (
        <p className="mt-2 text-sm leading-5 text-steel">
          Your CV already covers the keywords this job description calls out.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {tiers.must.length > 0 ? (
            <TierBlock tier="must" skills={tiers.must} />
          ) : (
            <p className="text-sm leading-5 text-moss">
              No deal-breaker gaps detected — the rest below are softer asks.
            </p>
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
                    Hide softer gaps
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" aria-hidden />
                    Show {collapsedCount} more {collapsedCount === 1 ? "gap" : "gaps"}
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

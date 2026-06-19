"use client";

import { Check } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { dedupe } from "@/app/_lib/dedupe";
import { MissingSkillsTiers } from "./MissingSkillsTiers";

type SkillChipsProps = {
  matchingSkills: string[];
  missingSkills: string[];
  evidence?: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Match the skill as a whole token so short skills ("R", "Go", "C", "AI") don't
// match inside unrelated words and "Java" doesn't claim "JavaScript" evidence.
// Boundaries are non-alphanumeric so special-charactered skills (C++, C#, .NET,
// Node.js) still match. Both sides are lowercased before testing.
//
// Internal whitespace in a multi-word skill matches ANY whitespace RUN (\s+), so
// "React Native" / "machine learning" still match evidence that double-spaces or
// line-wraps the phrase — the old single-literal-space pattern required an exact
// contiguous string and so showed no tooltip for genuinely-evidenced phrases.
function findEvidence(skill: string, evidence: string[] | undefined): string | null {
  if (!evidence?.length) return null;
  const needle = skill.trim().toLowerCase();
  if (!needle) return null;
  const body = needle.split(/\s+/).map(escapeRegExp).join("\\s+");
  const pattern = new RegExp(`(?:^|[^a-z0-9])${body}(?:$|[^a-z0-9])`);
  // Prefer the LONGEST matching snippet — it carries the most surrounding context
  // for the tooltip, rather than whichever happened to be listed first.
  let best: string | null = null;
  for (const snippet of evidence) {
    if (pattern.test(snippet.toLowerCase()) && (best === null || snippet.length > best.length)) {
      best = snippet;
    }
  }
  return best;
}

function MatchingChip({
  label,
  evidenceSnippet,
  tipId,
}: {
  label: string;
  evidenceSnippet: string | null;
  tipId: string;
}) {
  const [open, setOpen] = useState(false);
  const showTip = Boolean(evidenceSnippet) && open;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span
        tabIndex={evidenceSnippet ? 0 : -1}
        role={evidenceSnippet ? "button" : undefined}
        aria-describedby={showTip ? tipId : undefined}
        className={`focus-ring inline-flex items-center gap-1.5 rounded-full bg-limewash px-2.5 py-1 text-sm font-medium text-moss ${
          evidenceSnippet ? "cursor-help" : ""
        }`}
      >
        <Check className="h-3 w-3" aria-hidden />
        {label}
      </span>
      {showTip ? (
        <span
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm leading-5 text-ink shadow-panel"
        >
          {evidenceSnippet}
        </span>
      ) : null}
    </span>
  );
}

function MatchingSkillsColumn({ skills, evidence }: { skills: string[]; evidence?: string[] }) {
  const baseId = useId();
  const chips = useMemo(
    () =>
      dedupe(skills)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
        .map((skill) => ({ skill, evidenceSnippet: findEvidence(skill, evidence) })),
    [skills, evidence],
  );

  return (
    <div className="rounded-md bg-paper p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-meta uppercase text-steel">Matching Skills</h4>
      </div>
      {chips.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map(({ skill, evidenceSnippet }, index) => (
            <MatchingChip
              key={`${skill}-${index}`}
              label={skill}
              evidenceSnippet={evidenceSnippet}
              tipId={`${baseId}-chip-tip-${index}`}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-5 text-steel">
          Sharpen the skills section of your CV so we can pair it with the job description.
        </p>
      )}
    </div>
  );
}

export function SkillChips({ matchingSkills, missingSkills, evidence }: SkillChipsProps) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <MatchingSkillsColumn skills={matchingSkills} evidence={evidence} />
      <MissingSkillsTiers skills={missingSkills} />
    </div>
  );
}

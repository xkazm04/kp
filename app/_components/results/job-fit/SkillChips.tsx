"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { MissingSkillsTiers } from "./MissingSkillsTiers";

type SkillChipsProps = {
  matchingSkills: string[];
  missingSkills: string[];
  evidence?: string[];
};

function findEvidence(skill: string, evidence: string[] | undefined): string | null {
  if (!evidence?.length) return null;
  const needle = skill.trim().toLowerCase();
  if (!needle) return null;
  const hit = evidence.find((snippet) => snippet.toLowerCase().includes(needle));
  return hit ?? null;
}

function MatchingChip({
  label,
  evidenceSnippet,
}: {
  label: string;
  evidenceSnippet: string | null;
}) {
  const [open, setOpen] = useState(false);

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
        aria-describedby={evidenceSnippet && open ? `chip-tip-${label}` : undefined}
        className={`focus-ring inline-flex items-center gap-1.5 rounded-full bg-limewash px-2.5 py-1 text-sm font-medium text-moss ${
          evidenceSnippet ? "cursor-help" : ""
        }`}
      >
        <Check className="h-3 w-3" aria-hidden />
        {label}
      </span>
      {evidenceSnippet && open ? (
        <span
          id={`chip-tip-${label}`}
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
  const sorted = useMemo(
    () => [...skills].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [skills],
  );

  return (
    <div className="rounded-md bg-paper p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-meta uppercase text-steel">Matching Skills</h4>
      </div>
      {sorted.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sorted.map((skill) => (
            <MatchingChip
              key={skill}
              label={skill}
              evidenceSnippet={findEvidence(skill, evidence)}
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

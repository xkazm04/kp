import type { JobRecord } from "./db";

// Conversational, formless apply: a short chat that captures the candidate and
// runs job-derived knockout (KO) questions before they enter the pipeline.

export type ApplyStep =
  | { id: string; type: "text"; prompt: string; placeholder?: string }
  | { id: string; type: "ko"; prompt: string };

/** The KO step ids — a "no" on any of these declines the application. */
export const KO_STEP_IDS = ["ko_auth", "ko_mode", "ko_lang"] as const;

export function buildApplyScript(job: JobRecord): ApplyStep[] {
  const steps: ApplyStep[] = [
    {
      id: "name",
      type: "text",
      prompt: `Hi! Let's get you applied for ${job.title}${job.company ? ` at ${job.company}` : ""}. What's your name?`,
      placeholder: "Your name",
    },
    {
      id: "experience",
      type: "text",
      prompt: "Nice to meet you. In a sentence or two, what's your most relevant recent experience for this role?",
      placeholder: "e.g. 3 years building Node.js APIs…",
    },
    {
      id: "skills",
      type: "text",
      prompt: "Which skills should we highlight for this role? (comma-separated)",
      placeholder: "e.g. React, Node.js, SQL",
    },
    {
      id: "ko_auth",
      type: "ko",
      prompt: `Are you legally authorized to work in ${job.location || "the country for this role"}?`,
    },
  ];

  if (job.workMode && job.workMode.toLowerCase() !== "remote") {
    steps.push({
      id: "ko_mode",
      type: "ko",
      prompt: `This role is ${job.workMode}${job.location ? ` in ${job.location}` : ""}. Does that work for you?`,
    });
  }
  if (job.languages && job.languages.length) {
    steps.push({
      id: "ko_lang",
      type: "ko",
      prompt: `The role works in ${job.languages.join(" / ")}. Are you comfortable with that?`,
    });
  }
  return steps;
}

// Turn the captured answers into a CandidateProfileV2 intake draft (the same
// shape /api/profile takes), so a passing applicant becomes a real, matchable
// candidate rather than a label-only pipeline entry. Skills flow in as evidence
// (provenance-resolved by the Python normalizer).
export function buildApplyProfileDraft(
  job: JobRecord,
  answers: { name: string; experience: string; skills: string }
): { profile: Record<string, unknown>; signals: Record<string, unknown> } {
  const skillList = answers.skills
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const yearsMatch = /(\d{1,2})\s*\+?\s*(?:years|yrs|let|roky|rok)/i.exec(answers.experience);

  const profile: Record<string, unknown> = {
    displayName: answers.name,
    roleFamily: job.roleFamily ?? "software_engineering",
    languages: job.languages && job.languages.length ? job.languages : ["Czech", "English"],
    evidence: [
      {
        kind: "project",
        title: "Recent experience (from application)",
        text: answers.experience || "—",
        skills: skillList,
      },
    ],
  };
  if (yearsMatch) profile.yearsExperience = Number(yearsMatch[1]);
  return { profile, signals: { selfDeclared: "auto" } };
}

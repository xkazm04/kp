// Form field state + the AI-draft hydration split out of ProfileEditor.tsx: one hook owns
// every useState the editor's inputs read/write, plus applyDraft (the payload→form mapping
// shared by edit/duplicate hydration and an AI draft).
import { useState } from "react";
import type { SkillRow, EvidenceRow } from "@/app/features/shared/profileTypes";
import { hydrate, SKILL_FALLBACK, EVIDENCE_FALLBACK } from "./ProfileForm";
import type { ProfileDraft } from "./ProfileEditorAiDraft";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";

export function useProfileEditorFields(initialPayload: ProfilePayload | null) {
  // hydrate() maps a stored payload (edit/duplicate) — or null (blank create) —
  // into form state honestly: it never pre-fills education/languages/seniority the
  // candidate didn't declare, so a blank intake's completeness reflects real input
  // rather than unchosen defaults (idea-fa7d5360). Create and edit are identical now.
  const init = hydrate(initialPayload);

  const [choice, setChoice] = useState(init.choice);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [expectedGraduation, setExpectedGraduation] = useState("");
  const [wantsDomainChange, setWantsDomainChange] = useState(false);
  const [hasSubstantialExperience, setHasSubstantialExperience] = useState(false);

  const [displayName, setDisplayName] = useState(init.displayName);
  const [roleFamily, setRoleFamily] = useState(init.roleFamily);
  const [educationLevel, setEducationLevel] = useState(init.educationLevel);
  const [educationDetail, setEducationDetail] = useState(init.educationDetail);
  const [languages, setLanguages] = useState(init.languages);
  const [location, setLocation] = useState(init.location);
  const [availability, setAvailability] = useState(init.availability);
  const [yearsExperience, setYearsExperience] = useState(init.yearsExperience);
  const [seniority, setSeniority] = useState(init.seniority);
  const [aspirations, setAspirations] = useState(init.aspirations);

  const [skills, setSkills] = useState<SkillRow[]>(init.skills.length ? init.skills : SKILL_FALLBACK);
  const [evidence, setEvidence] = useState<EvidenceRow[]>(init.evidence.length ? init.evidence : EVIDENCE_FALLBACK);

  // Push an AI (or any) hydrated draft into the live form fields. Reuses the same
  // payload→form mapping as edit/duplicate so there is one source of that logic.
  const applyDraft = (draft: ProfileDraft) => {
    // A drafted profile is source data — reflect it faithfully so the AI's
    // omissions aren't backfilled with values the candidate never gave.
    const h = hydrate(draft.profile);
    setChoice(draft.archetype || h.choice);
    setDisplayName(h.displayName);
    setRoleFamily(h.roleFamily);
    setEducationLevel(h.educationLevel);
    setEducationDetail(h.educationDetail);
    setLanguages(h.languages);
    setLocation(h.location);
    setAvailability(h.availability);
    setYearsExperience(h.yearsExperience);
    setSeniority(h.seniority);
    setAspirations(h.aspirations);
    setSkills(h.skills.length ? h.skills : SKILL_FALLBACK);
    setEvidence(h.evidence.length ? h.evidence : EVIDENCE_FALLBACK);
    const s = draft.signals ?? {};
    setIsEnrolled(Boolean(s.isEnrolled));
    setExpectedGraduation(s.expectedGraduation ?? "");
    setWantsDomainChange(Boolean(s.wantsDomainChange));
    setHasSubstantialExperience(Boolean(s.hasSubstantialExperience));
  };

  return {
    choice, setChoice,
    isEnrolled, setIsEnrolled,
    expectedGraduation, setExpectedGraduation,
    wantsDomainChange, setWantsDomainChange,
    hasSubstantialExperience, setHasSubstantialExperience,
    displayName, setDisplayName,
    roleFamily, setRoleFamily,
    educationLevel, setEducationLevel,
    educationDetail, setEducationDetail,
    languages, setLanguages,
    location, setLocation,
    availability, setAvailability,
    yearsExperience, setYearsExperience,
    seniority, setSeniority,
    aspirations, setAspirations,
    skills, setSkills,
    evidence, setEvidence,
    applyDraft,
  };
}

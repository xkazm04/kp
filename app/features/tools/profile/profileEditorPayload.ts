// Pure profile/signals payload builder split out of ProfileEditor.tsx's build(), so the
// request-shaping logic can be read (and tested) without the surrounding fetch/toast/state.
import type { SkillRow, EvidenceRow } from "@/app/features/shared/profileTypes";
import { splitList } from "@/app/_lib/split-list";
import { archetypeScopedProfileFields } from "./ProfileForm";

// Editor inputs include multiline textareas (languages/skills/aspirations), so
// newline splitting is on; the shared helper owns the comma/semicolon parsing.
const splitField = (s: string) => splitList(s, { newlines: true });

export function buildProfilePayload(args: {
  displayName: string;
  roleFamily: string;
  educationLevel: string;
  educationDetail: string;
  languages: string;
  location: string;
  availability: string;
  aspirations: string;
  skills: SkillRow[];
  evidence: EvidenceRow[];
  choice: string;
  yearsExperience: string;
  seniority: string;
}): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    displayName: args.displayName || undefined,
    roleFamily: args.roleFamily,
    educationLevel: args.educationLevel,
    educationDetail: args.educationDetail,
    languages: splitField(args.languages),
    location: args.location || undefined,
    availability: args.availability || undefined,
    aspirations: splitField(args.aspirations),
    skillClaims: args.skills
      .filter((s) => s.skill.trim())
      .map((s) => ({ skill: s.skill.trim(), level: s.level, provenance: s.provenance })),
    evidence: args.evidence
      .filter((e) => e.title.trim() || e.text.trim())
      .map((e) => ({
        kind: e.kind,
        title: e.title.trim(),
        text: e.text.trim(),
        skills: splitField(e.skills),
        link: e.link.trim() || undefined,
      })),
  };
  // Submit years/seniority strictly by archetype visibility (idea-7ac9e45f): the
  // useState values persist across an archetype switch, but a field the form hid
  // for the selected archetype is never persisted. Shares its visibility source
  // with the inputs below, so the saved payload matches what is on screen.
  Object.assign(profile, archetypeScopedProfileFields(args.choice, args.yearsExperience, args.seniority));
  return profile;
}

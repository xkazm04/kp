"use client";

// "Who" (archetype/segments) + "Basics" form sections split out of ProfileEditor.tsx.
// Presentational only — all state lives in the parent editor.
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ROLE_FAMILIES, EDU_LEVELS, SENIORITIES } from "@/app/features/shared/profileTypes";
import { FIELD_DOM_ID } from "./profileCompletenessFields";
import { Section, Text, Pick, Check } from "./ProfileFields";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

export function ProfileEditorFields({
  choice,
  setChoice,
  archetypeOptions,
  isStudentish,
  isEnrolled,
  setIsEnrolled,
  expectedGraduation,
  setExpectedGraduation,
  gradError,
  wantsDomainChange,
  setWantsDomainChange,
  hasSubstantialExperience,
  setHasSubstantialExperience,
  displayName,
  setDisplayName,
  roleFamily,
  setRoleFamily,
  educationLevel,
  setEducationLevel,
  educationDetail,
  setEducationDetail,
  languages,
  setLanguages,
  location,
  setLocation,
  availability,
  setAvailability,
  fieldVis,
  yearsExperience,
  setYearsExperience,
  yearsError,
  seniority,
  setSeniority,
  aspirations,
  setAspirations,
}: {
  choice: string;
  setChoice: (v: string) => void;
  archetypeOptions: { value: string; label: ReactNode }[];
  isStudentish: boolean;
  isEnrolled: boolean;
  setIsEnrolled: (v: boolean) => void;
  expectedGraduation: string;
  setExpectedGraduation: (v: string) => void;
  gradError?: string;
  wantsDomainChange: boolean;
  setWantsDomainChange: (v: boolean) => void;
  hasSubstantialExperience: boolean;
  setHasSubstantialExperience: (v: boolean) => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  roleFamily: string;
  setRoleFamily: (v: string) => void;
  educationLevel: string;
  setEducationLevel: (v: string) => void;
  educationDetail: string;
  setEducationDetail: (v: string) => void;
  languages: string;
  setLanguages: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  availability: string;
  setAvailability: (v: string) => void;
  fieldVis: { years: boolean; seniority: boolean };
  yearsExperience: string;
  setYearsExperience: (v: string) => void;
  yearsError?: string;
  seniority: string;
  setSeniority: (v: string) => void;
  aspirations: string;
  setAspirations: (v: string) => void;
}) {
  const t = useTranslations("profile.editor");
  const enumLabel = useEnumLabel();

  return (
    <div className="space-y-4">
      <Section title={t("whoTitle")}>
        <SegmentedControl
          label={t("candidateArchetype")}
          value={choice}
          onChange={setChoice}
          options={archetypeOptions}
        />
        {isStudentish ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Check label={t("enrolled")} checked={isEnrolled} onChange={setIsEnrolled} />
            <Text label={t("expectedGrad")} value={expectedGraduation} onChange={setExpectedGraduation} placeholder={t("expectedGradPlaceholder")} error={gradError} />
            <Check label={t("wantsChange")} checked={wantsDomainChange} onChange={setWantsDomainChange} />
            <Check label={t("hasPrior")} checked={hasSubstantialExperience} onChange={setHasSubstantialExperience} />
          </div>
        ) : null}
      </Section>

      <Section title={t("basicsTitle")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Text label={t("name")} value={displayName} onChange={setDisplayName} placeholder={t("namePlaceholder")} />
          <Pick label={t("targetField")} value={roleFamily} onChange={setRoleFamily} options={ROLE_FAMILIES.map((f) => ({ v: f.v, label: enumLabel("family", f.v) }))} />
          <Pick id={FIELD_DOM_ID.educationLevel} label={t("eduLevel")} value={educationLevel} onChange={setEducationLevel} options={EDU_LEVELS.map((v) => ({ v, label: enumLabel("education", v) }))} />
          <Text id={FIELD_DOM_ID.languages} label={t("languages")} value={languages} onChange={setLanguages} placeholder={t("languagesPlaceholder")} />
          <Text label={t("location")} value={location} onChange={setLocation} placeholder={t("locationPlaceholder")} />
          <Text label={t("availability")} value={availability} onChange={setAvailability} placeholder={t("availabilityPlaceholder")} />
        </div>
        <Text
          id={FIELD_DOM_ID.educationDetail}
          className="mt-2"
          label={t("studyProgramme")}
          value={educationDetail}
          onChange={setEducationDetail}
          placeholder={t("studyPlaceholder")}
        />
        {fieldVis.years ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Text
              id={FIELD_DOM_ID.years}
              label={choice === "career_switcher" ? t("yearsExperienceSwitcher") : t("yearsExperience")}
              value={yearsExperience}
              onChange={setYearsExperience}
              placeholder={t("yearsPlaceholder")}
              error={yearsError}
            />
            {fieldVis.seniority ? (
              <Pick
                id={FIELD_DOM_ID.seniority}
                label={t("seniority")}
                value={seniority}
                onChange={setSeniority}
                // Offer an explicit "not set" option when seniority is empty (an
                // edited profile that never declared one) so the select shows the
                // true state instead of defaulting its display to "junior".
                options={(seniority ? SENIORITIES : ["", ...SENIORITIES]).map((v) => ({ v, label: v ? enumLabel("seniority", v) : t("notSet") }))}
              />
            ) : null}
          </div>
        ) : null}
        <Text
          id={FIELD_DOM_ID.aspirations}
          className="mt-2"
          label={t("aspirations")}
          value={aspirations}
          onChange={setAspirations}
          placeholder={t("aspirationsPlaceholder")}
        />
      </Section>
    </div>
  );
}

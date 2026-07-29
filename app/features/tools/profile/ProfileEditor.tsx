"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import type { ProfilePayload, ArchetypeDef } from "@/app/features/shared/profileTypes";
import { ProfileEvidenceColumn } from "./ProfileEvidenceColumn";
import { ResultPanel } from "./ProfileResultPanel";
import { ProfileEditorAiDraft } from "./ProfileEditorAiDraft";
import { ProfileEditorFields } from "./ProfileEditorFields";
import { buildArchetypeOptions } from "./ProfileEditorArchetypeOptions";
import { useProfileEditorFields } from "./useProfileEditorFields";
import { useProfileEditorSubmit } from "./useProfileEditorSubmit";
import { focusProfileField, validateProfileEditorFields } from "./profileEditorHelpers";
import { archetypeFieldVisibility } from "./ProfileForm";

export type EditorMode = "create" | "edit";

export function ProfileEditor({
  mode,
  editingId,
  initialPayload,
  sourceAnalysisSlug,
  archetypes,
  onCancel,
}: {
  mode: EditorMode;
  editingId: string | null;
  initialPayload: ProfilePayload | null;
  /** When the editor was opened FROM a saved CV analysis (build-from-analysis or a
   *  rebuild-from-latest), the slug of that analysis. Carried into the save so the
   *  route stamps source lineage; the recruiter still reviews before saving. */
  sourceAnalysisSlug?: string | null;
  /** Live archetype registry (ProfileTab's /api/archetypes fetch) — drives the routing segments. */
  archetypes: ArchetypeDef[];
  onCancel: () => void;
}) {
  const t = useTranslations("profile.editor");
  const router = useRouter();
  const params = useSearchParams();

  // Build→match handoff: navigate to the Match tab with THIS profile preselected —
  // MatchTab's ?profile= deep link auto-runs the match (one click, no re-selection).
  // Only reachable once a real saved id exists (the result panel gates the button).
  const goMatch = (savedId: string) =>
    router.push(buildUrl({ tab: "match", profile: savedId, edit: null }, params.toString()));

  const {
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
  } = useProfileEditorFields(initialPayload);

  const { result, loading, error, build: submit } = useProfileEditorSubmit({ t, mode, editingId, sourceAnalysisSlug });

  // Routing segments are REGISTRY-driven, not the static baseline list — see
  // ProfileEditorArchetypeOptions.tsx for why.
  const archetypeOptions = buildArchetypeOptions(t, archetypes, choice);

  const isStudentish = choice === "student" || choice === "auto" || choice === "career_switcher";
  // Years/seniority visibility for the chosen archetype. The render conditions below
  // and build()'s submission both read this one map, so what is shown is exactly what
  // is saved — no hidden, retained state can leak into the payload (idea-7ac9e45f).
  const fieldVis = archetypeFieldVisibility(choice);

  // persist=false → dry-run preview (always POST, never writes). persist=true →
  // POST a new row (create/duplicate) or PUT the edited row.
  const build = (persist: boolean) =>
    submit(persist, {
      displayName,
      roleFamily,
      educationLevel,
      educationDetail,
      languages,
      location,
      availability,
      aspirations,
      skills,
      evidence,
      choice,
      yearsExperience,
      seniority,
      isEnrolled,
      expectedGraduation,
      wantsDomainChange,
      hasSubstantialExperience,
    });

  const { yearsError, gradError, hasFieldErrors } = validateProfileEditorFields(t, fieldVis, yearsExperience, expectedGraduation);

  const heading = mode === "edit" ? t("headingEdit") : t("headingCreate");
  const saveLabel = mode === "edit" ? t("saveChanges") : t("saveProfile");

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring -ml-1 inline-flex items-center gap-1 rounded text-sm font-semibold text-steel hover:text-coral"
        >
          <ArrowLeft size={14} /> {t("back")}
        </button>
        <h2 className="mt-2 font-serif text-display text-ink">{heading}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          {t.rich("intro", { b: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </header>

      <ProfileEditorAiDraft onApplied={applyDraft} />

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <ProfileEditorFields
          choice={choice}
          setChoice={setChoice}
          archetypeOptions={archetypeOptions}
          isStudentish={isStudentish}
          isEnrolled={isEnrolled}
          setIsEnrolled={setIsEnrolled}
          expectedGraduation={expectedGraduation}
          setExpectedGraduation={setExpectedGraduation}
          gradError={gradError}
          wantsDomainChange={wantsDomainChange}
          setWantsDomainChange={setWantsDomainChange}
          hasSubstantialExperience={hasSubstantialExperience}
          setHasSubstantialExperience={setHasSubstantialExperience}
          displayName={displayName}
          setDisplayName={setDisplayName}
          roleFamily={roleFamily}
          setRoleFamily={setRoleFamily}
          educationLevel={educationLevel}
          setEducationLevel={setEducationLevel}
          educationDetail={educationDetail}
          setEducationDetail={setEducationDetail}
          languages={languages}
          setLanguages={setLanguages}
          location={location}
          setLocation={setLocation}
          availability={availability}
          setAvailability={setAvailability}
          fieldVis={fieldVis}
          yearsExperience={yearsExperience}
          setYearsExperience={setYearsExperience}
          yearsError={yearsError}
          seniority={seniority}
          setSeniority={setSeniority}
          aspirations={aspirations}
          setAspirations={setAspirations}
        />

        <ProfileEvidenceColumn skills={skills} setSkills={setSkills} evidence={evidence} setEvidence={setEvidence} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
        <button
          type="button"
          onClick={() => build(false)}
          disabled={loading || hasFieldErrors}
          className="focus-ring h-10 rounded-md border border-stone-200 px-4 text-base font-semibold text-ink hover:bg-paper disabled:opacity-40"
        >
          {loading ? t("working") : t("checkPreview")}
        </button>
        <button
          type="button"
          onClick={() => build(true)}
          disabled={loading || hasFieldErrors}
          className="focus-ring h-10 rounded-md bg-ink px-4 text-base font-semibold text-white disabled:opacity-40"
        >
          {saveLabel}
        </button>
      </div>

      {error ? <p className="mt-3 rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p> : null}
      {result ? (
        <ResultPanel
          result={result}
          onMatchNow={result.saved?.id ? () => goMatch(result.saved!.id) : undefined}
          onGoToField={focusProfileField}
        />
      ) : null}
    </section>
  );
}

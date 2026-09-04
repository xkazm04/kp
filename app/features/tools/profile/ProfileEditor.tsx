"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import type { ProfilePayload, ArchetypeDef } from "@/app/features/shared/profileTypes";
import { ProfileEvidenceColumn } from "./ProfileEvidenceColumn";
import { ProfileResultPanel } from "./ProfileResultPanel";
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
  initialUpdatedAt,
  sourceAnalysisSlug,
  archetypes,
  onCancel,
  onReload,
}: {
  mode: EditorMode;
  editingId: string | null;
  initialPayload: ProfilePayload | null;
  /** The row's `updated_at` at the moment this editor was opened. Rides into the PUT
   *  so a save that would clobber a newer version is refused instead. */
  initialUpdatedAt?: string | null;
  /** When the editor was opened FROM a saved CV analysis (build-from-analysis or a
   *  rebuild-from-latest), the slug of that analysis. Carried into the save so the
   *  route stamps source lineage; the recruiter still reviews before saving. */
  sourceAnalysisSlug?: string | null;
  /** Live archetype registry (ProfileTab's /api/archetypes fetch) — drives the routing segments. */
  archetypes: ArchetypeDef[];
  onCancel: () => void;
  /** Re-open this profile from the server — the answer to a refused (stale) save. */
  onReload?: () => void;
}) {
  const t = useTranslations("profile.editor");
  const router = useRouter();
  const params = useSearchParams();

  // Build→match handoff: navigate to the Match tab with THIS profile preselected —
  // Matrix's candidate-focus ?profile= deep link auto-runs the match (one click, no re-selection).
  // Only reachable once a real saved id exists (the result panel gates the button).
  const goMatch = (savedId: string) =>
    router.push(buildUrl({ tab: "matrix", profile: savedId, edit: null }, params.toString()));

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
    acceptDraftFully,
    undoDraft,
    dismissDraftNotice,
    draftApplied,
    draftConflicts,
    clearBackup,
  } = useProfileEditorFields(initialPayload, editingId);

  const { result, loading, error, stale, build: submit } = useProfileEditorSubmit({
    t,
    mode,
    editingId,
    sourceAnalysisSlug,
    initialUpdatedAt,
    // A persisted intake no longer needs its crash-safety copy; keeping it would
    // resurrect the saved form the next time this profile is opened.
    onPersisted: clearBackup,
  });

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
          onClick={() => {
            // Leaving is a decision, not a crash — drop the restore copy so the next
            // visit starts from the profile, not from an abandoned draft.
            clearBackup();
            onCancel();
          }}
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

      {/* What the draft was and was NOT allowed to touch. Before this, applyDraft set
          every field: a recruiter who had typed half the intake and then ran the draft
          lost it with no diff and no way back. The tab-level rebuild path has warned
          about exactly this since it shipped (ProfileTabRebuildWarnModal); this is the
          same idiom inside the editor, plus a one-click undo. */}
      {draftApplied ? (
        <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">
            {draftConflicts.length ? t("draftKeptEdits", { count: draftConflicts.length }) : t("draftAppliedNote")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draftConflicts.length ? (
              <button
                type="button"
                onClick={acceptDraftFully}
                className="focus-ring h-8 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-ink hover:bg-paper"
              >
                {t("draftUseAnyway")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={undoDraft}
              className="focus-ring h-8 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-ink hover:bg-paper"
            >
              {t("draftUndo")}
            </button>
            <button
              type="button"
              onClick={dismissDraftNotice}
              className="focus-ring h-8 rounded-md px-3 text-sm font-semibold text-steel hover:text-ink"
            >
              {t("draftKeep")}
            </button>
          </div>
        </div>
      ) : null}

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

      {/* A refused save is not an error the recruiter can retry into — the row moved.
          Say so, and offer the only action that resolves it. The form is left exactly
          as typed so nothing is lost before they choose. */}
      {stale ? (
        <div role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-base text-amber-800">
          <p>{t("staleSave")}</p>
          {onReload ? (
            <button
              type="button"
              onClick={() => {
                clearBackup();
                onReload();
              }}
              className="focus-ring mt-2 h-8 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-ink hover:bg-paper"
            >
              {t("staleReload")}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p> : null}
      {result ? (
        <ProfileResultPanel
          result={result}
          onMatchNow={result.saved?.id ? () => goMatch(result.saved!.id) : undefined}
          onGoToField={focusProfileField}
        />
      ) : null}
    </section>
  );
}

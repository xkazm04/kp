// Small pure/DOM helpers split out of ProfileEditor.tsx: focus-a-field and inline field
// validation, kept together since both are tiny and neither owns component state.
import type { useTranslations } from "next-intl";
import { FIELD_DOM_ID, type ProfileFieldKey } from "./profileCompletenessFields";

type Translator = ReturnType<typeof useTranslations>;

// Completeness "Add next" → scroll the matching input into view and focus it, so
// each gap is one click from being filled instead of inert prose.
export function focusProfileField(key: ProfileFieldKey) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(FIELD_DOM_ID[key]);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
    "input, select, textarea, button"
  )?.focus({ preventScroll: true });
}

// Inline field validation: catch a non-numeric "years" (would POST NaN) and a
// malformed graduation year before the request, and gate Save on validity.
// Validate years and graduation only while the field is visible — a stale, hidden
// value won't be submitted, so it must not block Save either. Graduation is shown
// for studentish archetypes (`isStudentish` in ProfileEditor), not via
// archetypeFieldVisibility, so callers pass `graduation` beside `years`.
export function validateProfileEditorFields(
  t: Translator,
  fieldVis: { years: boolean; graduation: boolean },
  yearsExperience: string,
  expectedGraduation: string
) {
  const yearsError =
    fieldVis.years && yearsExperience.trim() !== "" && !/^\d{1,2}(\.\d)?$/.test(yearsExperience.trim())
      ? t("yearsError")
      : undefined;
  const gradError =
    fieldVis.graduation && expectedGraduation.trim() !== "" && !/^(19|20)\d{2}$/.test(expectedGraduation.trim())
      ? t("gradError")
      : undefined;
  return { yearsError, gradError, hasFieldErrors: Boolean(yearsError || gradError) };
}

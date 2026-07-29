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
// Validate years only while the field is visible for the chosen archetype — a
// stale, hidden value won't be submitted, so it must not block Save either.
export function validateProfileEditorFields(
  t: Translator,
  fieldVis: { years: boolean },
  yearsExperience: string,
  expectedGraduation: string
) {
  const yearsError =
    fieldVis.years && yearsExperience.trim() !== "" && !/^\d{1,2}(\.\d)?$/.test(yearsExperience.trim())
      ? t("yearsError")
      : undefined;
  const gradError =
    expectedGraduation.trim() !== "" && !/^(19|20)\d{2}$/.test(expectedGraduation.trim())
      ? t("gradError")
      : undefined;
  return { yearsError, gradError, hasFieldErrors: Boolean(yearsError || gradError) };
}

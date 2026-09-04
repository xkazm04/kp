import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

/**
 * The DIALOG language for one role-intake session.
 *
 * Every intake route used to clamp with the same hand-written ternary —
 * `lang === "cs" ? "cs" : "en"`, six copies of it — so a German or French
 * operator, whose whole workspace chrome is already in their language, was
 * answered by an intake agent speaking English. Nothing was missing downstream:
 * `pipeline/jobfit/i18n.py` has carried `de` and `fr` in `LANG_NAMES` all along,
 * and `language_directive` names the right target language for either. The
 * clamps were simply older than the locale set, and each copy had to be found
 * before any of them could be fixed.
 *
 * The vocabulary comes from `i18n/locales.ts` — the ONE declaration of which
 * languages this product ships (`LOCALES`, `isLocale`) — so adding a fifth
 * locale reaches the intake dialog by adding it there, not by finding six more
 * ternaries. The primary subtag is honoured (`de-AT` → `de`) because the value
 * on the row is whatever the client sent when the session was created.
 *
 * The KEYLESS path is a narrower promise, deliberately: the deterministic slot
 * script in `pipeline/jobfit/intake.py` (`_Q`, `_readback`, `_close_reply`)
 * carries en and cs only, and falls back to its English text for anything else.
 * So a `de` session with no provider configured is asked its questions in
 * English while the brief it fills is the same one — versus today, where the
 * MODEL was also told to answer in English. Stated in the feature doc's Known
 * gaps rather than papered over.
 */
export function intakeLang(input: unknown): Locale {
  if (typeof input !== "string") return DEFAULT_LOCALE;
  const primary = input.trim().toLowerCase().split("-")[0];
  return isLocale(primary) ? primary : DEFAULT_LOCALE;
}

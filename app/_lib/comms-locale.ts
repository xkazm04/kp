// Candidate-comms locale resolution (backlog #34 / pa-l2-null-locale). One
// authority for "which language does this candidate hear from us in":
//
//   1. the entry's stored `locale` — the candidate's EXPLICIT choice, captured at
//      apply (conversational / quick-apply / webhook), on the stop page's language
//      control (locale_chosen_at stamped, every same-person entry in the team), or
//      inherited on rematch;
//   2. else the WORKSPACE default (getWorkspaceDefaultLocale: the team's explicit
//      override, else its org's language; 'cs' for the ČS seed) — the read-time fallback that stops the 60/65 NULL-locale entries
//      from receiving English letters under the bank's brand, with NO data
//      migration (legacy rows stay NULL and resolve here on every dispatch);
//   3. else DEFAULT_LOCALE — only when even the workspace row is unreadable.
//
// Write paths that have no explicit choice INFER from the candidate's CV
// languages (inferLocaleFromLanguages — the TS mirror of Python's
// _candidate_lang in pipeline/jobfit/automation.py) and store the result, so
// the entry carries a truthful locale going forward; anything still unknown
// stays NULL and resolves through the workspace default at read time.

import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { getWorkspaceDefaultLocale } from "./db/workspaces";
import { getProfileRecord } from "./db/profiles";
import { ensureDb } from "./db/core";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";

/** The locale every candidate-facing comm for this entry renders in: the
 *  entry's own (valid) locale, else the entry's WORKSPACE default. Never throws —
 *  a detached/unseeded context degrades to DEFAULT_LOCALE rather than failing a
 *  dispatch over locale bookkeeping.
 *
 *  `workspaceId` is the team the entry was filed into (webhook.workspaceId, which
 *  intakeLead/ingestCvApplication already carry). Pass it so a NULL-locale
 *  candidate falls back to THEIR team's language, not a fixed tenant's. A team's
 *  language resolves through getWorkspaceDefaultLocale: its explicit override
 *  (setWorkspaceDefaultLocale), else its ORG's language (organizations.default_locale,
 *  which Settings → Organization writes via setOrganizationLocale). Omitting the id
 *  reads DEFAULT_WORKSPACE_ID, which is the wrong tenant the moment a second team
 *  sits in another org or carries its own override and a NULL-locale candidate is
 *  filed into it: that candidate would be written to in the DEFAULT team's language.
 *
 *  Every candidate-facing dispatcher now passes the id (comms-dispatch.candidateLocale
 *  threads `entry.workspaceId` — surfaced on PipelineEntry since db/core.ts stopped
 *  dropping it — and the entry-less dispatchers thread their caller's
 *  `opts.workspaceId`). Callers that still omit it get the default tenant's default,
 *  the historical behaviour. */
export function resolveCommsLocale(locale: string | null | undefined, workspaceId?: string): Locale {
  if (isLocale(locale)) return locale;
  try {
    return getWorkspaceDefaultLocale(workspaceId);
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Candidate-declared language name -> app locale, the TS twin of Python's
 *  `_DECLARED_LANG_TO_LOCALE` (`pipeline/jobfit/automation.py`). Only the four
 *  app locales are resolvable; any other declared language is ignored. ASCII-
 *  folded stems ("cesky", "francais", "nemcina") sit beside the diacritic forms
 *  so a folded CV still resolves. Order is the Python tuple order: a de+fr list
 *  with neither Czech nor English lands on `de` (first declared app locale). */
const DECLARED_LANG_TO_LOCALE: readonly { locale: Locale; aliases: readonly string[] }[] = [
  { locale: "cs", aliases: ["czech", "česk", "češ", "cesk", "ceš", "cest"] },
  { locale: "de", aliases: ["german", "deutsch", "němč", "nemc"] },
  { locale: "fr", aliases: ["french", "français", "francais"] },
  { locale: "en", aliases: ["english", "anglič", "anglic"] },
];

/** Infer a comms locale from a CV's detected/self-reported languages (the
 *  analysis already captures these on the profile payload). Mirrors Python's
 *  `_candidate_lang` over the four app locales:
 *    Czech (home-lang tiebreak) wins with English;
 *    English wins over a third language (lingua-franca tiebreak);
 *    a de/fr-only list returns `de` / `fr`;
 *    empty/absent/unmapped ⇒ null (no signal — let the workspace default decide
 *    at dispatch; Python falls back to English here, TS does not, on purpose). */
export function inferLocaleFromLanguages(languages: readonly unknown[] | null | undefined): Locale | null {
  if (!Array.isArray(languages) || languages.length === 0) return null;
  const blob = languages
    .filter((l): l is string => typeof l === "string")
    .join(" ")
    .toLowerCase();
  if (!blob.trim()) return null;
  const declared = DECLARED_LANG_TO_LOCALE.filter(({ aliases }) => aliases.some((a) => blob.includes(a))).map(
    ({ locale }) => locale
  );
  if (declared.length === 0) return null;
  if (declared.includes("cs")) return "cs";
  if (declared.includes("en")) return "en";
  return declared[0] ?? null;
}

/** The newest language this person CHOSE for our letters in `workspaceId` (the stop
 *  page's control, db/pipeline-locale.ts stamps locale_chosen_at), else null. Here, not
 *  in the leaf, so the many route graphs that reach this module gain no module. */
export function chosenLocaleForCandidate(candidateId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): Locale | null {
  if (!candidateId.trim()) return null;
  const row = ensureDb()
    .prepare(
      `SELECT locale FROM pipeline_entries WHERE workspace_id = ? AND candidate_id = ? AND locale_chosen_at IS NOT NULL ORDER BY locale_chosen_at DESC LIMIT 1`
    )
    .get(workspaceId, candidateId) as { locale: string | null } | undefined;
  const locale = row?.locale;
  return isLocale(locale) ? locale : null;
}

/** Convenience for the write paths that file a candidate FROM a saved profile
 *  (add-to-pipeline, sourcing reach-out, sim inbound, dev-case sourcing): look
 *  the profile up and infer from its `languages`. Null when the profile is
 *  missing/unreadable or carries no language signal — the entry stores NULL and
 *  the workspace default applies at dispatch. A language the candidate CHOSE for this
 *  workspace (chosenLocaleForCandidate) wins over the inference. Never throws. */
export function inferProfileLocale(candidateId: string | null | undefined, workspaceId?: string): Locale | null {
  if (!candidateId) return null;
  try {
    // The person's own statement (the stop page's language control) outranks any
    // inference: a new entry must not overwrite "write to me in English" with a guess.
    const chosen = chosenLocaleForCandidate(candidateId, workspaceId);
    if (chosen) return chosen;
    // Scoped: an unscoped read resolved against the default team, so on any other
    // workspace this missed and every entry it stamped got `locale: null` —
    // degrading all downstream candidate comms to the workspace default language.
    const rec = getProfileRecord(candidateId, workspaceId);
    const languages = (rec?.payload as { languages?: unknown[] } | null)?.languages;
    return inferLocaleFromLanguages(Array.isArray(languages) ? languages : null);
  } catch {
    return null;
  }
}

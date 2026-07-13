// Candidate-comms locale resolution (backlog #34 / pa-l2-null-locale). One
// authority for "which language does this candidate hear from us in":
//
//   1. the entry's stored `locale` — the candidate's EXPLICIT choice, captured at
//      apply (conversational / quick-apply / webhook) or inherited on rematch;
//   2. else the WORKSPACE default (workspaces.default_locale, 'cs' for the ČS
//      seed) — the read-time fallback that stops the 60/65 NULL-locale entries
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

/** The locale every candidate-facing comm for this entry renders in: the
 *  entry's own (valid) locale, else the entry's WORKSPACE default. Never throws —
 *  a detached/unseeded context degrades to DEFAULT_LOCALE rather than failing a
 *  dispatch over locale bookkeeping.
 *
 *  `workspaceId` is the team the entry was filed into (webhook.workspaceId, which
 *  intakeLead/ingestCvApplication already carry). Pass it so a NULL-locale
 *  candidate falls back to THEIR team's default_locale, not a fixed tenant's.
 *  Omitting it reads DEFAULT_WORKSPACE_ID — behaviour-preserving today (every
 *  webhook defaults to "workspace", so there is only one default_locale to read),
 *  and the reason finding #5 is Low, not a live bug. The latent wrong-language
 *  lands the day a second workspace with a different default_locale exists AND a
 *  NULL-locale candidate is filed into it; closing it fully then only needs the
 *  dispatch call sites (comms-dispatch.formatOfferDeadline/dispatch,
 *  automation-run — both owned elsewhere) to surface `entry.workspaceId` (not yet
 *  on the PipelineEntry type) and pass it here. This helper is already ready for
 *  that id. */
export function resolveCommsLocale(locale: string | null | undefined, workspaceId?: string): Locale {
  if (isLocale(locale)) return locale;
  try {
    return getWorkspaceDefaultLocale(workspaceId);
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Infer a comms locale from a CV's detected/self-reported languages (the
 *  analysis already captures these on the profile payload). Mirrors Python's
 *  `_candidate_lang`: any Czech mention ⇒ "cs"; a non-empty list without Czech
 *  ⇒ "en"; an empty/absent list ⇒ null (no signal — let the workspace default
 *  decide at dispatch). */
export function inferLocaleFromLanguages(languages: readonly unknown[] | null | undefined): Locale | null {
  if (!Array.isArray(languages) || languages.length === 0) return null;
  const blob = languages
    .filter((l): l is string => typeof l === "string")
    .join(" ")
    .toLowerCase();
  if (!blob.trim()) return null;
  return blob.includes("czech") || blob.includes("česk") || blob.includes("cesk") || blob.includes("češt") ? "cs" : "en";
}

/** Convenience for the write paths that file a candidate FROM a saved profile
 *  (add-to-pipeline, sourcing reach-out, sim inbound, dev-case sourcing): look
 *  the profile up and infer from its `languages`. Null when the profile is
 *  missing/unreadable or carries no language signal — the entry stores NULL and
 *  the workspace default applies at dispatch. Never throws. */
export function inferProfileLocale(candidateId: string | null | undefined): Locale | null {
  if (!candidateId) return null;
  try {
    const rec = getProfileRecord(candidateId);
    const languages = (rec?.payload as { languages?: unknown[] } | null)?.languages;
    return inferLocaleFromLanguages(Array.isArray(languages) ? languages : null);
  } catch {
    return null;
  }
}

// Which language variant of the public JD page is served.
//
// Opening a role in several languages renders and stores the posting in each of them
// (job_translations, app/_lib/job-translate-run.ts). This is the one public reader of
// those renderings, and it follows canonical-fallback serving: fall back per WHOLE
// unit (a translated title + body, or the JD's own title + body, never a mix), keep
// the source path byte-identical (no ?lang=, or a ?lang= with nothing fresh stored,
// serves exactly what it always did), and derive the language offer from what can be
// served rather than from the locale list.
//
// Pure except for the injected reads, so the tenancy rule is testable: every read
// binds the OWNER team loadPublicJd resolved from the JD row, never the viewer's.

import { jdJobId } from "@/app/_lib/jd-limits";
import { coerceLocale, DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locales";

/** A stored rendering as the store returns it (JobTranslation's shape, minus jobId). */
export type StoredJdTranslation = {
  lang: string;
  sourceLang: string;
  title: string;
  bodyMd: string;
  createdAt: string;
};

/** The public projection: no timestamp, no workspace, no job row. */
export type PublicJdTranslation = { lang: Locale; sourceLang: string; title: string; bodyMd: string };

export type PublicJdVariant =
  | { kind: "canonical" }
  | { kind: "translated"; lang: Locale; title: string; body: string; fromLang: string };

type ServableInput = {
  sourceLang: string;
  translations: readonly StoredJdTranslation[];
  /** jdLastEditedAt(slug, owner): null when the JD was never edited. */
  lastEditedAt: string | null;
  archived: boolean;
};

/** A rendering is only a translation of the CURRENT text if it was made after the
 *  JD's last edit. A successful re-ingest drops them (deleteJobTranslations), but a
 *  JD edit whose best-effort re-ingest failed leaves the old ones in place. An
 *  unreadable stamp is treated as stale: serving the original is the safe side. */
function isFresh(createdAt: string, lastEditedAt: string | null): boolean {
  if (lastEditedAt === null) return true;
  const made = Date.parse(createdAt);
  const edited = Date.parse(lastEditedAt);
  if (Number.isNaN(made) || Number.isNaN(edited)) return false;
  return made > edited;
}

/** The translations this page may serve and advertise, in LOCALES order. */
export function servablePublicJdTranslations(input: ServableInput): PublicJdTranslation[] {
  if (input.archived) return [];
  const out: PublicJdTranslation[] = [];
  for (const locale of LOCALES) {
    if (locale === input.sourceLang) continue;
    const row = input.translations.find((t) => t.lang === locale);
    if (!row || !isFresh(row.createdAt, input.lastEditedAt) || !row.bodyMd.trim()) continue;
    out.push({ lang: locale, sourceLang: row.sourceLang, title: row.title, bodyMd: row.bodyMd });
  }
  return out;
}

/** The explicit `?lang=` a visitor asked for, folded like the proxy folds it. */
export function publicJdRequestedLang(requested: unknown): Locale | null {
  return coerceLocale(Array.isArray(requested) ? requested[0] : requested);
}

export function resolvePublicJdVariant(input: ServableInput & { requested: unknown }): PublicJdVariant {
  return pickPublicJdVariant(input.sourceLang, servablePublicJdTranslations(input), input.requested);
}

function pickPublicJdVariant(sourceLang: string, served: readonly PublicJdTranslation[], requested: unknown): PublicJdVariant {
  const lang = publicJdRequestedLang(requested);
  if (!lang || lang === sourceLang) return { kind: "canonical" };
  const hit = served.find((t) => t.lang === lang);
  if (!hit) return { kind: "canonical" };
  return { kind: "translated", lang, title: hit.title, body: hit.bodyMd, fromLang: sourceLang };
}

export type PublicJdLanguageReads = {
  translations: (jobId: string, workspaceId: string) => readonly StoredJdTranslation[];
  lastEditedAt: (slug: string, workspaceId: string) => string | null;
  /** The posting's source language (postingSourceLang over the owner's open config). */
  sourceLang: (jobId: string, workspaceId: string) => string;
};

export type PublicJdLanguages = {
  sourceLang: string;
  translations: PublicJdTranslation[];
};

/** Read everything the variant needs, bound to the OWNER team. A store fault
 *  degrades to "nothing translated": the original always renders. */
export function loadPublicJdLanguages(
  jd: { slug: string; owner: string; archived: boolean },
  reads: PublicJdLanguageReads
): PublicJdLanguages {
  const jobId = jdJobId(jd.slug);
  try {
    const stored = reads.translations(jobId, jd.owner);
    const lastEditedAt = reads.lastEditedAt(jd.slug, jd.owner);
    const sourceLang = reads.sourceLang(jobId, jd.owner);
    return {
      sourceLang,
      translations: servablePublicJdTranslations({ sourceLang, translations: stored, lastEditedAt, archived: jd.archived }),
    };
  } catch {
    /* best-effort: translations are an enhancement of a page that must always render its original */
    return { sourceLang: DEFAULT_LOCALE, translations: [] };
  }
}

/** Resolve the variant from what loadPublicJdLanguages already filtered. */
export function publicJdVariantFor(langs: PublicJdLanguages, requested: unknown, archived: boolean): PublicJdVariant {
  if (archived) return { kind: "canonical" };
  return pickPublicJdVariant(langs.sourceLang, langs.translations, requested);
}

export type PublicJdServedView = {
  title: string;
  body: string;
  /** The body's language when it differs from the page chrome's declared one. */
  bodyLang: string | undefined;
  /** Operator JdActions edit the ORIGINAL, so they mount only on it. */
  showActions: boolean;
  disclosure: { fromLang: string; originalHref: string } | null;
};

export function publicJdServedView(opts: {
  slug: string;
  jd: { title: string; body: string };
  canManage: boolean;
  variant: PublicJdVariant;
}): PublicJdServedView {
  if (opts.variant.kind === "canonical") {
    return { title: opts.jd.title, body: opts.jd.body, bodyLang: undefined, showActions: opts.canManage, disclosure: null };
  }
  return {
    title: opts.variant.title,
    body: opts.variant.body,
    bodyLang: opts.variant.lang,
    showActions: false,
    disclosure: { fromLang: opts.variant.fromLang, originalHref: `/jds/${encodeURIComponent(opts.slug)}` },
  };
}

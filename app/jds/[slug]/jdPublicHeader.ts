// Public JD page header composition. Pure so a candidate share-link render
// cannot grow an operator toolbar without a red test: Edit/Archive/History already
// sit behind `canManage`, and Analyze CV + the job-board Publish teaser must too.

export const PUBLIC_JD_HEADER_ACTIONS = ["apply", "notAccepting", "publish", "analyzeCv"] as const;
export type PublicJdHeaderAction = (typeof PUBLIC_JD_HEADER_ACTIONS)[number];

export function publicJdHeaderActions(opts: {
  canManage: boolean;
  applyOpen: boolean;
}): PublicJdHeaderAction[] {
  const actions: PublicJdHeaderAction[] = [opts.applyOpen ? "apply" : "notAccepting"];
  if (opts.canManage) {
    actions.push("publish", "analyzeCv");
  }
  return actions;
}

/** hreflang + canonical for the public JD page, derived from what it SERVES.
 *
 *  The offer is the posting's source language plus every language with a fresh
 *  stored translation (jdPublicVariant.ts), never the whole LOCALES list: a
 *  `?lang=de` with nothing rendered serves the English original, so advertising it
 *  as German content was a claim the page could not keep. Each served variant is
 *  self-canonical (a shared canonical folded the translations into the original, so
 *  a translated page could never rank); the bare path and any unserved `?lang=`
 *  canonicalise to the original.
 *
 *  Always returns an object. Next merges metadata SHALLOWLY, so a page that omits
 *  `alternates` inherits app/layout.tsx's four `./?lang=` alternates; an archived
 *  (noindex) role sets an explicit empty `languages` to override them. */
export function publicJdAlternates(
  slug: string,
  opts: { archived: boolean; sourceLang: string; servedLangs: readonly string[]; requested: string | null },
): { canonical: string; languages: Record<string, string> } {
  const path = `/jds/${encodeURIComponent(slug)}`;
  if (opts.archived) return { canonical: path, languages: {} };
  const offered = [opts.sourceLang, ...opts.servedLangs.filter((l) => l !== opts.sourceLang)];
  const languages: Record<string, string> = {};
  for (const lang of offered) languages[lang] = `${path}?lang=${lang}`;
  languages["x-default"] = path;
  const self = opts.requested && offered.includes(opts.requested) ? `${path}?lang=${opts.requested}` : path;
  return { canonical: self, languages };
}

/** Apply on the public page: linked job is open AND the JD itself is not archived. */
export function isPublicJdApplyOpen(opts: {
  hasLinkedJob: boolean;
  jobOpenForApplications: boolean;
  archivedAt: string | number | null | undefined;
}): boolean {
  return Boolean(opts.hasLinkedJob && opts.jobOpenForApplications && !opts.archivedAt);
}

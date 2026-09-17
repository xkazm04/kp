// Public JD page header composition. Pure so a candidate share-link render
// cannot grow an operator toolbar without a red test: Edit/Archive/History already
// sit behind `canManage`, and Analyze CV + the job-board Publish teaser must too.

import { LOCALES } from "@/i18n/locales";

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

/** hreflang + canonical for a live public JD. Archived roles stay noindex and
 *  must not advertise language alternates of a page we do not want ranked. */
export function publicJdAlternates(
  slug: string,
  archived: boolean,
): { canonical: string; languages: Record<string, string> } | undefined {
  if (archived) return undefined;
  const path = `/jds/${encodeURIComponent(slug)}`;
  return {
    canonical: path,
    languages: {
      ...Object.fromEntries(LOCALES.map((l) => [l, `${path}?lang=${l}`])),
      "x-default": path,
    },
  };
}

/** Apply on the public page: linked job is open AND the JD itself is not archived. */
export function isPublicJdApplyOpen(opts: {
  hasLinkedJob: boolean;
  jobOpenForApplications: boolean;
  archivedAt: string | number | null | undefined;
}): boolean {
  return Boolean(opts.hasLinkedJob && opts.jobOpenForApplications && !opts.archivedAt);
}

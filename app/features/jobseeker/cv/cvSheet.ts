// The designed CV's words that are the SHEET's, not the document's: the headings as the
// sheet sets them and the separator of an entry's first line. Pure, so the sheet
// (DesignedCv.tsx), its plain-text reading (cvRoundTrip.ts) and `node --test` share one
// spelling of each.

import { CV_HEADINGS, type CvDocument, type CvLang } from "./cvDocument";

/** The projects heading, per CV language - document content like CV_HEADINGS, which does
 *  not carry it yet; a `projects` entry there wins. */
export const CV_PROJECTS_HEADING: Record<CvLang, string> = { en: "Projects", cs: "Projekty", de: "Projekte", fr: "Projets" };

/** Between a role and its employer on the entry's one line - the keyless draft's own
 *  "Role — Org" form, which the builder's parseRoleTitle reads back. */
export const CV_ORG_SEPARATOR = " — ";

export function cvHeadingsOf(doc: Pick<CvDocument, "lang">) {
  const h = CV_HEADINGS[doc.lang] as (typeof CV_HEADINGS)[CvLang] & { projects?: string };
  return { ...h, projects: h.projects ?? CV_PROJECTS_HEADING[doc.lang] };
}

/** A CSS string literal for text the SEEKER wrote (their name in the running head): every
 *  character outside letters, digits and plain punctuation is a hex escape, so no quote,
 *  backslash or `</style` can leave the literal. */
export function cssString(text: string): string {
  const body = [...text].map((c) => (/[\p{L}\p{N} .,'&-]/u.test(c) ? c : `\\${c.codePointAt(0)!.toString(16)} `)).join("");
  return `"${body}"`;
}

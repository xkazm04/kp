// The designed CV's URL state, named once. Three readers must build the SAME sheet from
// it: the designer's preview (which writes it), /me/cv/print (which reads it on the
// server), and GET /api/jobseeker/cv.pdf (which passes it through to the print page that
// headless Chromium loads). A parameter one of them forgot is a PDF that differs from the
// preview, so they all go through `parseCvDesign` and `cvDesignQuery`.

import { isCvAccent, isCvTemplate, type CvAccent, type CvTemplate } from "./cvDocument";

export type CvDesign = {
  template: CvTemplate;
  accent: CvAccent;
  /** An index into the seeker's `targetTitles`; null = not tailored. */
  tailor: number | null;
  /** cvTailor `compactOffTarget` (only meaningful while tailored). */
  compact: boolean;
  /** cvTailor `objective` (only meaningful while tailored). */
  objective: boolean;
};

export const CV_DESIGN_DEFAULT: CvDesign = { template: "sidebar", accent: "navy", tailor: null, compact: false, objective: true };

/** A seeker names a handful of targets; an index past this is not one of them. */
const TAILOR_MAX = 19;

type Getter = (key: string) => string | string[] | null | undefined;

function first(v: string | string[] | null | undefined): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** Read the design from URL parameters; anything out of vocabulary falls back to the
 *  default rather than failing — a stale bookmark still opens a CV. */
export function parseCvDesign(get: Getter): CvDesign {
  const template = first(get("template"));
  const accent = first(get("accent"));
  const tailorRaw = first(get("tailor"));
  const tailorN = tailorRaw !== null && /^\d{1,2}$/.test(tailorRaw) ? Number(tailorRaw) : null;
  return {
    template: isCvTemplate(template) ? template : CV_DESIGN_DEFAULT.template,
    accent: isCvAccent(accent) ? accent : CV_DESIGN_DEFAULT.accent,
    tailor: tailorN !== null && tailorN <= TAILOR_MAX ? tailorN : null,
    compact: first(get("compact")) === "1",
    objective: first(get("objective")) !== "0",
  };
}

/** The print page the PDF route hands headless Chromium, from the request's own query:
 *  every design key passes through, re-validated, and nothing else does. */
export function cvPrintPath(params: URLSearchParams): string {
  return `/me/cv/print?${cvDesignQuery(parseCvDesign((k) => params.get(k)))}`;
}

/** The query string for a design; the tailoring keys ride only while tailored, so an
 *  untailored URL stays `template=&accent=` as before. */
export function cvDesignQuery(d: CvDesign): string {
  const q = new URLSearchParams({ template: d.template, accent: d.accent });
  if (d.tailor !== null) {
    q.set("tailor", String(d.tailor));
    if (d.compact) q.set("compact", "1");
    if (!d.objective) q.set("objective", "0");
  }
  return q.toString();
}

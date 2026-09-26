// The designed CV's URL state, named once. Three readers must build the SAME sheet from
// it: the designer's preview (which writes it), /me/cv/print (which reads it on the
// server), and GET /api/jobseeker/cv.pdf (which passes it through to the print page that
// headless Chromium loads). A parameter one of them forgot is a PDF that differs from the
// preview, so they all go through `parseCvDesign` and `cvDesignQuery`.

// The design vocabulary lives here, beside the URL that carries it: which layouts and
// accents exist is a PRESENTATION fact (cv.css draws them), not part of the document model.
//
// `classic` is the default and the one single-flow layout (registry
// recruiting/cv-presentation-and-parseability, technique parse-safe-reading-order: "one
// column for everything that carries identity, time or work ... the default for every
// template"). `editorial` is single-flow too. `sidebar` and `compact` set skills and
// languages in a second column: a positional parser reads them interleaved with the work
// (scripts/cv/roundtrip.mjs measures it), so they are opt-in and the designer offers the
// single-flow PDF beside them.
export const CV_TEMPLATES = ["classic", "editorial", "sidebar", "compact"] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];
export const CV_ACCENTS = ["navy", "moss", "coral", "plum"] as const;
export type CvAccent = (typeof CV_ACCENTS)[number];

/** Whether a layout's extracted text keeps its visual order for BOTH a content-order and
 *  a positional reader - measured over the reference CVs by `npm run cv:roundtrip`, and
 *  restated here only from its result. */
export const CV_SINGLE_FLOW: Record<CvTemplate, boolean> = { classic: true, editorial: true, sidebar: false, compact: false };

export function isCvTemplate(v: unknown): v is CvTemplate {
  return typeof v === "string" && (CV_TEMPLATES as readonly string[]).includes(v);
}
export function isCvAccent(v: unknown): v is CvAccent {
  return typeof v === "string" && (CV_ACCENTS as readonly string[]).includes(v);
}

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

export const CV_DESIGN_DEFAULT: CvDesign = { template: "classic", accent: "navy", tailor: null, compact: false, objective: true };

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

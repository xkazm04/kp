// The designed CV's URL state, named once. Three readers must build the SAME sheet from
// it: the designer's preview (which writes it), /me/cv/print (which reads it on the
// server), and GET /api/jobseeker/cv.pdf (which passes it through to the print page that
// headless Chromium loads). A parameter one of them forgot is a PDF that differs from the
// preview, so they all go through `parseCvDesign` and `cvDesignQuery`.

// The design vocabulary lives here, beside the URL that carries it: which layouts and
// accents exist is a PRESENTATION fact (cv.css draws them), not part of the document model.
//
// `studio` is the default, and every layout but two is single-flow (registry
// recruiting/cv-presentation-and-parseability, technique parse-safe-reading-order: "one
// column for everything that carries identity, time or work ... the default for every
// template"): studio, signal and folio are the current presets, classic and editorial the
// earlier ones. `sidebar` and `compact` set skills and languages in a second column: a
// positional parser reads them interleaved with the work (scripts/cv/roundtrip.mjs
// measures it), so they are opt-in and the designer offers the single-flow PDF beside
// them. The order is the picker's: the default first, the columned ones last.
export const CV_TEMPLATES = ["studio", "signal", "folio", "classic", "editorial", "sidebar", "compact"] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];
/** Ink (the sheet's own text colour, for a monochrome page), then the hues cool to warm. */
export const CV_ACCENTS = ["ink", "navy", "cobalt", "teal", "moss", "tangerine", "coral", "plum"] as const;
export type CvAccent = (typeof CV_ACCENTS)[number];

/** Whether a layout's extracted text keeps its visual order for BOTH a content-order and
 *  a positional reader - measured over the reference CVs by `npm run cv:roundtrip`, and
 *  restated here only from its result. */
export const CV_SINGLE_FLOW: Record<CvTemplate, boolean> = { studio: true, signal: true, folio: true, classic: true, editorial: true, sidebar: false, compact: false };

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
  /** SAVED designs only (this browser's localStorage, the server's ui-state): the version
   *  of the default it was saved under. Never in a URL - a URL's `template` is always an
   *  explicit choice. See `migrateSavedCvDesign`. */
  v?: CvDesignVersion;
};

export const CV_DESIGN_DEFAULT: CvDesign = { template: "studio", accent: "cobalt", tailor: null, compact: false, objective: true };

/** 3 = saved since `studio` in `cobalt` became the default. Every version stores the design
 *  it shows, so a saved copy of the default of its day cannot tell a choice from a default
 *  that was merely stored: `sidebar` before any marker, `classic` under 2, `navy` under
 *  both. */
export const CV_DESIGN_VERSION = 3;
const SAVED_VERSIONS = [2, CV_DESIGN_VERSION] as const;
export type CvDesignVersion = (typeof SAVED_VERSIONS)[number];
/** What each earlier version stored without asking - its default. */
const UNCHOSEN_UNMARKED = { template: "sidebar", accent: "navy" } as const satisfies Pick<CvDesign, "template" | "accent">;
const UNCHOSEN_BY_VERSION: Record<Exclude<CvDesignVersion, typeof CV_DESIGN_VERSION>, Pick<CvDesign, "template" | "accent">> = {
  2: { template: "classic", accent: "navy" },
};

/** A saved design from before the current marker reads the defaults OF ITS DAY as NEVER
 *  CHOSEN - once: an unmarked `sidebar`, a v2 `classic`, a `navy` under either. The result
 *  carries the current marker, the caller saves it back, and from then on whatever the
 *  seeker picks (those included) sticks. Every other field, template and accent is kept as
 *  saved - an unmarked `classic` was a choice, made while `sidebar` was the default. A
 *  current-marked design passes through untouched. */
export function migrateSavedCvDesign(d: CvDesign): CvDesign {
  if (d.v === CV_DESIGN_VERSION) return d;
  const unchosen = d.v === undefined ? UNCHOSEN_UNMARKED : UNCHOSEN_BY_VERSION[d.v];
  return {
    ...d,
    template: d.template === unchosen.template ? CV_DESIGN_DEFAULT.template : d.template,
    accent: d.accent === unchosen.accent ? CV_DESIGN_DEFAULT.accent : d.accent,
    v: CV_DESIGN_VERSION,
  };
}

/** A saved design object (a JSON record, not a URL) through the one validator; its
 *  version marker rides along. Null when it is not a record. Not migrated - the caller
 *  compares before and after to know whether to save the migration back. */
export function parseSavedCvDesign(raw: unknown): CvDesign | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return parseCvDesign((key) => {
    const value = r[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isInteger(value)) return String(value);
    if (typeof value === "boolean") return value ? "1" : "0";
    return null;
  });
}

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
  const v = SAVED_VERSIONS.find((n) => first(get("v")) === String(n));
  return {
    template: isCvTemplate(template) ? template : CV_DESIGN_DEFAULT.template,
    accent: isCvAccent(accent) ? accent : CV_DESIGN_DEFAULT.accent,
    tailor: tailorN !== null && tailorN <= TAILOR_MAX ? tailorN : null,
    compact: first(get("compact")) === "1",
    objective: first(get("objective")) !== "0",
    // A saved record's version marker (the ui-state route stores what this returns).
    ...(v !== undefined ? { v } : {}),
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

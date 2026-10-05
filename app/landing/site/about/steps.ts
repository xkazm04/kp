import { ABOUT_STEP_KEYS, type AboutStepKey } from "../../spark/about-art/shared";

/*
 * About's step data that is not copy: the colours each step borrows from the
 * console key it grows out of, where its handwritten note sits, and the sample
 * figures the page draws. The COPY lives in the catalogs: `aboutPage.steps.*`
 * (eyebrow, title, body: today's wording, reused) and `siteAbout.*` (the
 * prototype's notes, gate, tape, stepper and map labels).
 */
export const STEP_KEYS = ABOUT_STEP_KEYS;
export type StepKey = AboutStepKey;
export const STEP_COUNT = STEP_KEYS.length;

export type StepPaint = { color: string; hi: string; ink: string };

/** design=salary, source=recall, intake=inbox, screen=fit, assignment=work,
 *  interview=voice, offer=offer, hired=book/moss (prototype about-data.js). */
export const STEP_PAINT: Record<StepKey, StepPaint> = {
  design: { color: "#7fb3a8", hi: "#a5d3c8", ink: "#17202a" },
  source: { color: "#b9c1c9", hi: "#dbe1e6", ink: "#17202a" },
  intake: { color: "#dce7d0", hi: "#eef5e4", ink: "#17202a" },
  screen: { color: "#d65a4a", hi: "#ee7a66", ink: "#fdf8ee" },
  assignment: { color: "#caa54c", hi: "#e6c46a", ink: "#17202a" },
  interview: { color: "#42606f", hi: "#6d93a5", ink: "#fdf8ee" },
  offer: { color: "#b8452f", hi: "#e0765f", ink: "#fdf8ee" },
  hired: { color: "#526b4f", hi: "#8fb58a", ink: "#fdf8ee" }
};

/** The page colour before the first step and between steps (brass). */
export const OVERVIEW_PAINT = { color: "#caa54c", hi: "#e6c46a" } as const;

/** Where each handwritten note sits over its drawing: [left %, lift %, tilt deg]. */
export const NOTE_POS: readonly (readonly [number, number, number])[] = STEP_KEYS.map(() => [2, -1, -3] as const);

/** Steps with a scope pill after the eyebrow ("technical roles"). */
export const STEP_SCOPED: ReadonlySet<StepKey> = new Set<StepKey>(["assignment"]);

/** Invented sample data (the page says so in its captions and legal line). */
export const SAMPLE = {
  /** Who signs the gates. */
  signer: "M. Horáková",
  /** The candidate walking the line (the pawn). */
  person: "Jana N.",
  /** Her initials on the hero LCD's token. */
  initials: "JN",
  /** The letter on the pawn. */
  pawn: "J"
} as const;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The step's short name, taken from its eyebrow ("Step 04 · Screen" -> "Screen"), the
 *  same derivation as aboutStepRailLabel, so a name and its heading never disagree. */
export function stepName(eyebrow: string): string {
  const i = eyebrow.lastIndexOf("·");
  return i >= 0 ? eyebrow.slice(i + 1).trim() : eyebrow.trim();
}

/** Phones and portrait windows: the stacked layout (about.css and tokens.css). */
export const MOBILE_QUERY = "(max-width: 899px), (max-aspect-ratio: 5/4)";
export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

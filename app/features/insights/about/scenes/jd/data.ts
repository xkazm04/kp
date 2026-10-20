/*
 * Chapter 1 — THE GROUNDING, as data.
 *
 * The beat table `JdGrounding.tsx` renders from, and the constants
 * chapters.test.ts pins. Pure (imports only the stage ladder), so
 * scenes/beats.test.ts walks every phase against the clock contract.
 *
 * Beats (CYCLE = 15 @ 900ms): 0 outline · 1 sources · 2 rows open · 3-8 six
 * requirements attach · 9 the seventh fails · 10 it fades · 11 the gap is
 * reported · 12 the cap chip · 13-14 hold. STILL = 12 (was 13, one beat late).
 */
import { stageOf, type ModuleStage } from "../../stage/stages";

export const CYCLE = 15;
export const STILL = 12;

/** The beats the status line changes on; `about.jd.status.s<n>` for each. */
export const STATUS_BEATS = [0, 2, 3, 9, 10, 11, 12] as const;
export type StatusBeat = (typeof STATUS_BEATS)[number];

/**
 * Right-hand rows. `src` is the index of the source each one attaches to;
 * `null` means nothing in the inputs states it — the row that never prints.
 *
 * Two kinds of row label, and the difference is a localization rule rather than
 * a styling one (the same rule `CodeLabel`'s `code` prop states):
 *
 *   text: "code"  — a product noun. "TypeScript", "React 19", "Playwright",
 *                   "Kafka" are the same word in every locale, and putting them
 *                   in the catalog would invite four translators to render them
 *                   four ways. They stay here.
 *   text: "prose" — a requirement written as a SENTENCE. "Owning a service end
 *                   to end" is English, not an identifier, and shipping it from
 *                   this array meant a Czech reader met three untranslated
 *                   lines in the middle of a translated deck. These resolve
 *                   from `about.jd.reqs.<key>`.
 *
 * `id` is the React key and stays stable across locales; it is never rendered.
 */
export type ReqKey = "stack" | "ownership" | "languages";

export type Req = { id: string; src: number | null; kind: "must" | "nice" } & (
  | { text: "code"; code: string }
  | { text: "prose"; key: ReqKey }
);

export const REQS: readonly Req[] = [
  { id: "typescript", text: "code", code: "TypeScript", src: 2, kind: "must" },
  { id: "react", text: "code", code: "React 19", src: 2, kind: "must" },
  { id: "stack", text: "prose", key: "stack", src: 1, kind: "must" },
  { id: "ownership", text: "prose", key: "ownership", src: 0, kind: "must" },
  { id: "languages", text: "prose", key: "languages", src: 0, kind: "must" },
  { id: "playwright", text: "code", code: "Playwright", src: 1, kind: "nice" },
  { id: "kafka", text: "code", code: "Kafka", src: null, kind: "must" },
];

// Each row lands on its own beat, starting at 3.
const landsAt = (i: number) => 3 + i;

export type JdFrame = {
  /** The three input cards. */
  sources: ModuleStage;
  sourceLabels: boolean;
  sourceDetails: boolean;
  /** Per REQS row: its chip, text and (if it has a source) its thread. */
  landed: readonly boolean[];
  /** The orphan loses opacity instead of leaving the tree. */
  orphanFaded: boolean;
  gap: boolean;
  gapNote: boolean;
};

export function sceneAt(phase: number): JdFrame {
  const at = (n: number) => phase >= n;
  return {
    sources: stageOf({ shell: 1, body: 1, detail: 2, chosen: null }, phase),
    sourceLabels: at(1),
    sourceDetails: at(2),
    landed: REQS.map((_, i) => at(landsAt(i))),
    orphanFaded: at(10),
    gap: at(11),
    gapNote: at(12),
  };
}

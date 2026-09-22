/*
 * Chapter 2 — THREE BUCKETS, as data.
 *
 * The beat table `ScoringBuckets.tsx` renders from, and the constants
 * chapters.test.ts pins. Pure (imports only the stage ladder), so
 * scenes/beats.test.ts walks every phase against the clock contract.
 *
 * Beats (CYCLE = 14 @ 900ms): 0 outline · 1 requirements · 2 the threshold ·
 * 3-8 one resolves per beat · 9 unproven reasons · 10 the sibling rule ·
 * 11-13 hold. STILL = 10 (was 11, one beat late).
 */
import { stageOf, type ModuleStage } from "../../stage/stages";

export const CYCLE = 14;
export const STILL = 10;

/** The beats the status line changes on; `about.scoring.status.s<n>` for each. */
export const STATUS_BEATS = [0, 2, 3, 9, 10] as const;
export type StatusBeat = (typeof STATUS_BEATS)[number];

export type Bucket = "matched" | "unproven" | "missing";
/** The `unproven_skill_reason` values, as a closed set for the typed catalog. */
export type Why = "adjacency" | "provenance" | "both";

export const REQS: readonly { skill: string; best: number; bucket: Bucket; why: Why | null }[] = [
  { skill: "TypeScript", best: 1.0, bucket: "matched", why: null },
  { skill: "React", best: 0.9, bucket: "matched", why: null },
  { skill: "Postgres", best: 0.62, bucket: "matched", why: null },
  { skill: "Kubernetes", best: 0.4, bucket: "unproven", why: "adjacency" },
  { skill: "Terraform", best: 0.28, bucket: "unproven", why: "provenance" },
  { skill: "Go", best: 0.18, bucket: "unproven", why: "both" },
  { skill: "Rust", best: 0.0, bucket: "missing", why: null },
];

/**
 * Where the painted line crosses the score track, as a fraction of it.
 * `_MATCH_THRESHOLD = 0.5` in pipeline/jobfit/matching.py — pinned there by
 * chapters.test.ts, because the whole chapter is the claim that THIS line is
 * where the product splits matched from unproven.
 */
export const THRESHOLD = 0.5;

/**
 * A code identifier the reader matches against pipeline/jobfit/taxonomy.py, not
 * copy — named constant, not JSX text (the machine-surface idiom;
 * i18next/no-literal-string is right to refuse it as a literal child).
 */
export const SIBLING_MATCH_LABEL = "_SIBLING_MATCH = 0.4";

const resolvesAt = (i: number) => 3 + i;

export type ScoringFrame = {
  threshold: boolean;
  names: boolean;
  /** Per REQS row: the row's own stage, and whether its score has resolved. */
  rows: readonly ModuleStage[];
  resolved: readonly boolean[];
  /** The unproven rows' WHY tags. */
  reasons: boolean;
  note: ModuleStage;
  noteBody: boolean;
};

export function sceneAt(phase: number): ScoringFrame {
  const at = (n: number) => phase >= n;
  return {
    threshold: at(2),
    names: at(1),
    rows: REQS.map((_, i) => stageOf({ shell: 1, body: 1, detail: resolvesAt(i), chosen: null }, phase)),
    resolved: REQS.map((_, i) => at(resolvesAt(i))),
    reasons: at(9),
    note: stageOf({ shell: 10, body: 10, detail: 10, chosen: null }, phase),
    noteBody: at(10),
  };
}

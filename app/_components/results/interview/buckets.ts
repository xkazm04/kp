// Bucket taxonomy + grouping for the interview kit (idea-90b9b3c2).
//
// interviewKit.questions[].bucket is an unconstrained z.string() (LLM output),
// so a question can carry a bucket outside the known vocabulary — a new value
// like "situational" or a typo like "behavioural". The InterviewTab tiles and
// filter chips used to be hardcoded to the three known buckets, so any
// off-taxonomy question was counted in "All" yet showed in no tile and was
// hidden by every specific filter chip: it silently vanished from filtered
// views while the tiles undercounted.
//
// This module is the single source of truth for the taxonomy and folds every
// unknown bucket into one "Other" group, so the per-group counts always sum to
// the total and no question can disappear. It is intentionally React/JSX-free
// (visual metadata — icons, tones — lives in InterviewTab.tsx, keyed by these
// same group keys) so the grouping logic stays unit-testable under `node
// --test` without a DOM.

export const KNOWN_BUCKETS = ["behavioral", "technical", "red-flag-defense"] as const;
export type KnownBucket = (typeof KNOWN_BUCKETS)[number];

export const OTHER_BUCKET = "other" as const;

/** A renderable group: one of the known buckets, or the catch-all "other". */
export type GroupKey = KnownBucket | typeof OTHER_BUCKET;

/** A filter selection: any group, or "all". */
export type FilterKey = "all" | GroupKey;

export type BucketGroup = { key: GroupKey; count: number };

const KNOWN_SET = new Set<string>(KNOWN_BUCKETS);

/** Map a raw bucket string to its renderable group, folding unknowns to "other". */
export function classifyBucket(bucket: string): GroupKey {
  return KNOWN_SET.has(bucket) ? (bucket as KnownBucket) : OTHER_BUCKET;
}

/**
 * Group questions by bucket and return only the groups actually present, in a
 * stable order: the known buckets first (canonical order), then "other" if any
 * off-taxonomy questions exist. The returned counts always sum to
 * questions.length, so the tiles never undercount.
 */
export function groupBuckets(questions: ReadonlyArray<{ bucket: string }>): BucketGroup[] {
  const counts = new Map<GroupKey, number>();
  for (const question of questions) {
    const key = classifyBucket(question.bucket);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order: GroupKey[] = [...KNOWN_BUCKETS, OTHER_BUCKET];
  return order
    .filter((key) => (counts.get(key) ?? 0) > 0)
    .map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

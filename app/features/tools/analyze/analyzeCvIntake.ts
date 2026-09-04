// The CV-variant intake decision, extracted from useAnalyzeCvFiles so it can be
// tested over real File objects without a React renderer.
//
// Three rules live here and all three had failure modes that no test would have
// caught, because there was no test:
//
//  • THE CAP. MAX_CV_VARIANTS is checked before the hash and again after it — a
//    queued add awaits crypto.subtle, and a sibling add can fill the last slot in
//    that gap, so the pre-check alone lets the list overflow by one.
//  • DEDUPE BY CONTENT. Identity is the file's bytes (cvVariantHash), the same
//    rule the server intake uses, so the two sides cannot disagree about what a
//    duplicate is. The rule it replaced — name AND size match — silently merged
//    two genuinely different CVs that happened to share both.
//  • THE HASH IS ALLOWED TO FAIL. crypto.subtle needs a secure context. When it
//    is unavailable the file is ADMITTED, not dropped: the server can always
//    hash and is the authoritative deduper, and silently discarding a recruiter's
//    upload is far worse than analysing one clone.
//
// The hook keeps the serialization (each add awaits the previous one) and the
// synchronous ref advance that makes a queued add see its predecessor's append;
// this module is the per-file verdict those mechanics feed.

import { isDuplicateCvVariant } from "@/app/_lib/cv-variant";

export const CV_INTAKE_OUTCOMES = ["added", "duplicate", "capped"] as const;
export type CvIntakeOutcome = (typeof CV_INTAKE_OUTCOMES)[number];

export function isCvIntakeOutcome(value: unknown): value is CvIntakeOutcome {
  return typeof value === "string" && (CV_INTAKE_OUTCOMES as readonly string[]).includes(value);
}

export type CvIntakeResult = { outcome: CvIntakeOutcome; files: File[] };

/**
 * Decide what `current` becomes when `file` arrives. Pure with respect to state:
 * it returns the next list (a NEW array on "added", the same contents otherwise)
 * and never mutates the input.
 *
 * `isDuplicate` is injectable purely so a test can drive the "hashing threw"
 * branch — a secure context is not something a unit test can revoke.
 */
export async function admitCvFile(
  current: readonly File[],
  file: File,
  maxVariants: number,
  isDuplicate: (candidate: File, existing: readonly File[]) => Promise<boolean> = (candidate, existing) =>
    isDuplicateCvVariant(candidate, existing as File[])
): Promise<CvIntakeResult> {
  const snapshot = [...current];
  if (snapshot.length >= maxVariants) return { outcome: "capped", files: snapshot };

  let duplicate = false;
  try {
    duplicate = await isDuplicate(file, snapshot);
  } catch {
    // Hashing needs crypto.subtle (a secure context). If it is unavailable we must
    // not silently drop the file — admit it and let the server, which can always
    // hash, be the authoritative dedupe. A dropped upload is the worse failure.
    duplicate = false;
  }
  if (duplicate) return { outcome: "duplicate", files: snapshot };
  return { outcome: "added", files: [...snapshot, file] };
}

/**
 * The post-await cap re-check. `admitCvFile` reads a snapshot taken before the
 * hash await; the hook re-reads its live ref afterwards, and this is the guard
 * that turns a list which filled during the await into a refusal instead of an
 * over-cap append.
 */
export function fitsWithinCap(live: readonly File[], maxVariants: number): boolean {
  return live.length + 1 <= maxVariants;
}

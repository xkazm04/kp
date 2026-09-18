// Reading a job's interview kit, and laying a recruiter's per-candidate edits over a
// plan (spark interview-kit-template).
//
// This is the READ SEAM the interview side consumes: the agenda builder and the two
// provider briefs ask for "the kit for this job" or "the kit this link pinned" and get a
// `StoredInterviewKit` or null. The versioned store behind it is db/interview-kits.ts —
// kept one module away so the interview path imports a two-function read surface rather
// than the whole append/publish vocabulary, and so a job with no kit stays a plain null
// (exactly today's behaviour) instead of a special case at every call site.

import { interviewKitById, interviewKitLatestPublished } from "./db/interview-kits";
import { EMPTY_KIT_OVERLAY, type KitOverlay, type StoredInterviewKit } from "./interview-kit-types";

/** The kit version new links for this job are minted from: the highest PUBLISHED
 *  version, or null when the job has no published kit. Workspace-scoped like every
 *  job-keyed read. */
export function latestPublishedKit(jobId: string, workspaceId: string): StoredInterviewKit | null {
  return interviewKitLatestPublished(jobId, workspaceId);
}

/** One stored kit version by id — what a MINTED link pinned, which may be older than
 *  the latest published one. */
export function kitById(kitId: string, workspaceId: string): StoredInterviewKit | null {
  return interviewKitById(kitId, workspaceId);
}

/** Narrow an untrusted stored value to a KitOverlay, falling back to the empty one. A
 *  malformed overlay must never fail an interview — the candidate's plan simply runs
 *  without the recruiter's edits, which is the safe direction. */
export function coerceKitOverlay(value: unknown): KitOverlay {
  if (value === null || typeof value !== "object") return EMPTY_KIT_OVERLAY;
  const v = value as Partial<KitOverlay>;
  if (v.version !== 1) return EMPTY_KIT_OVERLAY;
  return {
    version: 1,
    dropped: Array.isArray(v.dropped) ? v.dropped.filter((id): id is string => typeof id === "string") : [],
    edited: Array.isArray(v.edited)
      ? v.edited.filter(
          (e): e is { id: string; text: string } =>
            e !== null && typeof e === "object" && typeof (e as { id?: unknown }).id === "string" && typeof (e as { text?: unknown }).text === "string"
        )
      : [],
    added: Array.isArray(v.added)
      ? v.added.filter(
          (a): a is KitOverlay["added"][number] =>
            a !== null &&
            typeof a === "object" &&
            typeof (a as { id?: unknown }).id === "string" &&
            typeof (a as { text?: unknown }).text === "string"
        )
      : [],
  };
}

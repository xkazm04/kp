// Rematch/re-engagement link parsing (rematch-story-navigable).
//
// The two re-engagement events carry a machine-written `detail` that encodes the
// COUNTERPART pipeline entry — the other half of a "this person, two roles" link:
//
//   • `rematched` (stamped on the SOURCE entry by rematchSourceEntry in db/pipeline.ts)
//       detail = "<fromJobId> -> <toJobId> (<targetEntryId>)"
//       → the counterpart is the TARGET entry the person was redirected INTO.
//
//   • `rematched_from` (stamped on the TARGET entry by linkTerminalPriorsToTarget in
//       rediscovery-prior-link.ts)
//       detail = "<priorEntryId> (<priorJobId>)"
//       → the counterpart is the PRIOR entry the person was re-engaged FROM.
//
// Before this, both details rendered as dead text (the kinds weren't in EVENT_KINDS)
// and the drawer dropped the detail entirely. This PURE parser turns each detail into
// a structured reference so the drawer can offer a navigable affordance. It is
// deliberately defensive: an unparseable / malformed / legacy detail resolves to null
// (honest non-link text), never a broken link. The referenced entry is resolved for
// existence SEPARATELY, server-side, so a deleted or other-tenant counterpart also
// degrades to plain text.

/** A parsed counterpart reference from a rematch event detail. */
export type RematchRef = {
  /** The counterpart pipeline entry id to open. */
  entryId: string;
  /** The counterpart's job id, when the detail carried one (null for "?"/absent). */
  jobId: string | null;
};

const cleanJob = (raw: string | undefined): string | null => {
  const v = (raw ?? "").trim();
  return v && v !== "?" ? v : null;
};

/** Parse a rematch event detail into its counterpart reference, or null when the
 *  kind isn't a rematch kind or the detail doesn't match the documented shape.
 *  Pure — no DB, safe in the client bundle. */
export function parseRematchDetail(kind: string, detail: string | null | undefined): RematchRef | null {
  if (!detail) return null;
  if (kind === "rematched") {
    // "<fromJobId> -> <toJobId> (<targetEntryId>)" — the target job then the target
    // entry id in trailing parens. Anchored to the END so a job id containing spaces
    // or arrows can't confuse the capture.
    const m = detail.match(/->\s*(.*?)\s*\(([^()]+)\)\s*$/);
    if (!m) return null;
    const entryId = m[2].trim();
    if (!entryId) return null;
    return { entryId, jobId: cleanJob(m[1]) };
  }
  if (kind === "rematched_from") {
    // "<priorEntryId> (<priorJobId>)" — the prior entry id, then its job id in parens.
    const m = detail.match(/^\s*(\S+)\s*\(([^()]*)\)\s*$/);
    if (!m) return null;
    const entryId = m[1].trim();
    if (!entryId) return null;
    return { entryId, jobId: cleanJob(m[2]) };
  }
  return null;
}

/** The rematch event kinds — both sides of a re-engagement link. */
export const REMATCH_KINDS = ["rematched", "rematched_from"] as const;

/** True for either rematch kind. */
export function isRematchKind(kind: string): boolean {
  return kind === "rematched" || kind === "rematched_from";
}

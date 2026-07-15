import type { PipelineEvent } from "./db";

// Public projection of the Activity feed (idea-4c41d103).
//
// GET /api/pipeline/events is reachable without authentication (kp has no auth
// layer yet — see harness-learnings), and it used to serialize raw
// pipeline_events rows: full candidate names paired with rejection/decline
// outcomes, the role they applied for, their archetype, and the internal
// entry_id (the same id other entry-keyed routes accept — an IDOR handle).
// Candidate identity tied to hiring outcomes is sensitive personal data; anyone
// who could reach the app origin could enumerate who is in the funnel and how
// they fared.
//
// The projection keeps the feed operationally useful for the workspace —
// kind/stages/detail/time drive the verbs and glyphs — while reducing identity
// to initials and dropping the internal id + archetype entirely. When an auth
// layer lands (open follow-up), the full feed can return for authenticated
// recruiters; until then the public payload carries no harvestable identity.

export type PublicPipelineEvent = {
  id: number;
  /** Initials only (e.g. "M. K."), never the full candidate name. */
  candidateLabel: string | null;
  jobTitle: string | null;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
};

/** Reduce a display name to initials: "Marie Kovová" → "M. K.". Uses at most
 *  the first two whitespace-separated tokens; empty/whitespace input → null. */
export function initialsLabel(label: string | null): string | null {
  if (!label) return null;
  const parts = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return null;
  return parts.map((p) => `${p[0].toUpperCase()}.`).join(" ");
}

// rematch-story-navigable — the re-engagement details ("<job> -> <job> (<entryId>)"
// / "<entryId> (<jobId>)") embed an INTERNAL pipeline entry id: the exact IDOR handle
// this projection exists to strip. The public feed renders these kinds by verb alone
// (useEventVerb), so the detail is operationally unused here — null it out rather than
// leak the counterpart entry id. The payload shape stays additive (detail is still the
// same nullable field).
const DETAIL_REDACTED_KINDS = new Set(["rematched", "rematched_from"]);

/** Project a raw event row to its public shape — initials for identity, no
 *  entryId (IDOR handle), no archetype. */
export function toPublicPipelineEvent(ev: PipelineEvent): PublicPipelineEvent {
  return {
    id: ev.id,
    candidateLabel: initialsLabel(ev.candidateLabel),
    jobTitle: ev.jobTitle,
    kind: ev.kind,
    fromStage: ev.fromStage,
    toStage: ev.toStage,
    detail: DETAIL_REDACTED_KINDS.has(ev.kind) ? null : ev.detail,
    createdAt: ev.createdAt,
  };
}

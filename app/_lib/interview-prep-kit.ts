// The job interview kit as the PREP MODAL sees it, and the one trust boundary for a
// recruiter's per-candidate overlay (spark interview-kit-template, WP-C).
//
// SERVER-ONLY: it reads the kit store, the interview sessions and the entry. The modal's
// pure half — the caps and the agenda mirror — is interview-kit-overlay.ts.

import { latestInterviewByEntry } from "./db/interviews";
import { getPipelineEntry } from "./db/pipeline";
import { isEarlyCareer } from "./archetypes";
import { submissionFollowups } from "./interview-planned-minutes";
import { coerceKitOverlay, kitById, latestPublishedKit } from "./interview-kit";
import { kitOverlayProblems, type KitOverlayProblem } from "./interview-kit-overlay";
import type { InterviewKit, KitOverlay, StoredInterviewKit } from "./interview-kit-types";

/** Link states whose pinned kit still decides what the candidate is asked: the link was
 *  sent and not yet used up. The same set revokeOpenInterviewSessions treats as open. */
const OPEN_LINK_STATES = new Set(["created", "in_progress", "failed"]);

/** The kit a candidate's plan comes from, as the prep modal needs it. */
export type PrepKitView = {
  kitId: string;
  version: number;
  status: StoredInterviewKit["status"];
  /** True when this is the version the candidate's OPEN interview link was minted
   *  with. False means it is the job's latest published version — what the NEXT link
   *  will be minted from. */
  pinned: boolean;
  /** Whether this candidate's own CV probes ride the interview at all. They do only on
   *  the prep branch: a work-sample debrief keeps its authorship probes and an
   *  early-career candidate runs the student script (interview-agenda.ts). The modal
   *  hides the probe list rather than promising questions the agenda never adds. */
  cvProbesRide: boolean;
  kit: InterviewKit;
};

/**
 * The kit version this entry's interview runs on, or null when its role has none.
 *
 * The PIN wins over the latest publish: a candidate already holding a link keeps the
 * questions their round opened with (interview-invite.ts pins at mint), so showing them
 * a newer version would describe an interview they will not have. With no open link,
 * the latest published version is the one the next link will carry.
 *
 * A kit that cannot be read never costs the recruiter the prep pack beside it — this
 * runs inside the prep GET — so a read fault answers null and is logged, because an
 * operator WOULD act on a role that silently lost its kit.
 */
export function prepKitForEntry(entryId: string, workspaceId: string): PrepKitView | null {
  try {
    const entry = getPipelineEntry(entryId, workspaceId);
    if (!entry?.jobId) return null;
    const session = latestInterviewByEntry(entryId, workspaceId);
    const pinnedKit =
      session && session.kitId && OPEN_LINK_STATES.has(session.status) ? kitById(session.kitId, workspaceId) : null;
    const stored = pinnedKit ?? latestPublishedKit(entry.jobId, workspaceId);
    if (!stored || !Array.isArray(stored.kit?.competencies)) return null;
    return {
      kitId: stored.id,
      version: stored.version,
      status: stored.status,
      pinned: pinnedKit !== null,
      cvProbesRide: submissionFollowups(entry).length === 0 && !isEarlyCareer(entry.archetype),
      kit: stored.kit,
    };
  } catch (err) {
    console.error(`[interview-prep] the interview kit for entry ${entryId} could not be read:`, err);
    return null;
  }
}

/** Why an incoming overlay was refused: a cap or content rule the modal shows before
 *  saving (KitOverlayProblem), or a body that is not an overlay at all. */
export type KitOverlayRejection = KitOverlayProblem | "malformed";

export type KitOverlayParse = { ok: true; overlay: KitOverlay } | { ok: false; reason: KitOverlayRejection };

/**
 * Narrow an untrusted request body value to a storable KitOverlay, or say why not.
 *
 * STRICTER THAN THE READ SIDE, on purpose. `coerceKitOverlay` is the READ boundary: an
 * overlay already stored must never fail an interview, so it quietly drops what it
 * cannot use. A WRITE is the opposite case — a recruiter is asking for exactly this to
 * be stored — so anything coercion would have to discard is refused instead, and the
 * modal is told rather than finding their edit gone at the next open. The coercer still
 * runs first, so the stored shape is by construction one the reader accepts.
 */
export function parseKitOverlayWrite(value: unknown): KitOverlayParse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "malformed" };
  const raw = value as { version?: unknown; dropped?: unknown; edited?: unknown; added?: unknown };
  if (raw.version !== 1 || !Array.isArray(raw.dropped) || !Array.isArray(raw.edited) || !Array.isArray(raw.added)) {
    return { ok: false, reason: "malformed" };
  }
  const coerced = coerceKitOverlay(value);
  if (
    coerced.dropped.length !== raw.dropped.length ||
    coerced.edited.length !== raw.edited.length ||
    coerced.added.length !== raw.added.length
  ) {
    return { ok: false, reason: "malformed" };
  }
  // The coercer checks id/text only; the two remaining added fields are typed here, and
  // every entry is REBUILT from its known keys so nothing else a client sent is stored.
  for (const a of coerced.added as { competencyId?: unknown; mustAsk?: unknown }[]) {
    if (a.competencyId !== undefined && a.competencyId !== null && typeof a.competencyId !== "string") {
      return { ok: false, reason: "malformed" };
    }
    if (a.mustAsk !== undefined && typeof a.mustAsk !== "boolean") return { ok: false, reason: "malformed" };
  }
  const overlay: KitOverlay = {
    version: 1,
    dropped: coerced.dropped.map((id) => id),
    edited: coerced.edited.map((e) => ({ id: e.id, text: e.text.trim() })),
    added: coerced.added.map((a) => ({
      id: a.id,
      competencyId: typeof a.competencyId === "string" && a.competencyId !== "" ? a.competencyId : null,
      text: a.text.trim(),
      mustAsk: a.mustAsk === true,
    })),
  };
  const problems = kitOverlayProblems(overlay);
  if (problems.length > 0) return { ok: false, reason: problems[0] };
  return { ok: true, overlay };
}

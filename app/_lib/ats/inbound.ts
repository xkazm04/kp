// W1.1 — the INGEST half of the ATS seam.
//
// `ats-record.ts` is deliberately egress-only and says so in its own header: kp emits a
// normalized `kp.ats.v1` record plus a signed webhook, and somebody else's connector lands
// it. That direction was never the hard one. The gap that loses deals is the other way:
// "does it pull our candidates IN?"
//
// This module is the inbound counterpart — the shape a connector produces after it has
// talked to a vendor, before anything touches the database. It is deliberately NOT
// `AtsCandidateRecord` reversed: that record carries kp-internal truth an external system
// cannot know (a sealed decision hash, a match score, an archetype we derived). Feeding
// those fields back in from outside would let a vendor payload assert facts about our own
// audit trail. So ingest accepts only what an ATS legitimately owns — who the person is,
// which role, where they are in the vendor's process, when they applied, what the CV says
// — and everything kp derives stays kp's to derive.
//
// EXTERNAL DATA IS UNTRUSTED. Every field is length-bounded and type-checked here rather
// than at the call site, and a record missing its identity (external id) is rejected
// rather than defaulted: without a stable external id, the next sync cannot tell an update
// from a new person and quietly duplicates the pipeline.
//
// Pure + dependency-free so it loads under `node --test`.

import { PIPELINE_STAGES, type PipelineStage } from "../pipeline-stages";

/** Bump on any breaking change to AtsInboundCandidate so a connector can pin a contract. */
export const ATS_INBOUND_SCHEMA_VERSION = "kp.ats.inbound.v1";

// Bounds. Generous enough for real names and long CVs, tight enough that a hostile or
// broken vendor response cannot balloon a row or a prompt.
const MAX_ID = 200;
const MAX_NAME = 200;
const MAX_CONTACT = 320; // RFC-5321 practical maximum for an email address
const MAX_LABEL = 200;
const MAX_CV_CHARS = 60_000;

export type AtsInboundCandidate = {
  schemaVersion: string;
  /** Which connector produced this (e.g. "recruitee"). Namespaces the external id. */
  provider: string;
  /** The vendor's own id for this application. The sync idempotency key — see links-store. */
  externalId: string;
  displayName: string;
  /** Deliverable address, when the vendor exposes one. */
  contact: string | null;
  /** The vendor's job/requisition id, and its title as they spell it. */
  externalJobId: string | null;
  jobTitle: string | null;
  /** Where the vendor thinks this person is, mapped onto kp's axis. Null when their stage
   *  had no mapping — the caller decides the default rather than inheriting a guess. */
  stage: PipelineStage | null;
  /** The vendor's own stage string, kept verbatim for audit and for tuning the map. */
  externalStage: string | null;
  appliedAt: string | null;
  /** Plain-text CV/resume when the vendor gives us one, for kp's own extraction. */
  cvText: string | null;
  /** Where the vendor says the candidate came from (job board, referral…). */
  sourceLabel: string | null;
};

export class AtsInboundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtsInboundError";
  }
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

/** ISO-8601 or nothing. A vendor's "2024/03/01" or epoch millis is NOT silently coerced:
 *  a wrong applied-at silently skews every time-to-hire figure downstream, and the metric
 *  pack publishes those. A connector that knows its vendor's format converts before here. */
function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return null;
  // Date.parse accepts "2024" and other loose forms; require a real date-ish prefix.
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? new Date(ms).toISOString() : null;
}

function isPipelineStage(v: unknown): v is PipelineStage {
  return typeof v === "string" && (PIPELINE_STAGES as readonly string[]).includes(v);
}

/**
 * Validate and normalize one inbound candidate. Throws AtsInboundError on the two things
 * that cannot be defaulted — a missing provider or external id — and quietly nulls
 * anything else that is absent or malformed.
 *
 * The asymmetry is deliberate: a missing name is a cosmetic gap a recruiter can fix, while
 * a missing external id breaks sync identity and silently duplicates people on every run.
 */
export function parseInboundCandidate(raw: unknown): AtsInboundCandidate {
  if (!raw || typeof raw !== "object") throw new AtsInboundError("inbound candidate must be an object.");
  const o = raw as Record<string, unknown>;

  const provider = str(o.provider, MAX_ID);
  if (!provider) throw new AtsInboundError("provider is required (it namespaces the external id).");
  const externalId = str(o.externalId, MAX_ID);
  if (!externalId) throw new AtsInboundError("externalId is required — without it a re-sync cannot tell an update from a new candidate.");

  const externalStage = str(o.externalStage, MAX_LABEL);
  return {
    schemaVersion: ATS_INBOUND_SCHEMA_VERSION,
    provider,
    externalId,
    // An unnamed application is still a real application; the vendor id is the identity.
    displayName: str(o.displayName, MAX_NAME) ?? externalId,
    contact: str(o.contact, MAX_CONTACT),
    externalJobId: str(o.externalJobId, MAX_ID),
    jobTitle: str(o.jobTitle, MAX_LABEL),
    stage: isPipelineStage(o.stage) ? o.stage : null,
    externalStage,
    appliedAt: isoOrNull(o.appliedAt),
    cvText: str(o.cvText, MAX_CV_CHARS),
    sourceLabel: str(o.sourceLabel, MAX_LABEL),
  };
}

/**
 * The inbound record projected onto the fields `buildAtsRecord` reads, so a candidate that
 * came in through a connector emits the same egress shape as one that applied directly.
 *
 * kp-derived fields are deliberately null: matchScore, roleFamily and archetype are OURS
 * to compute (and an ATS asserting them would be laundering an external opinion into our
 * scoring). `jobId` carries the EXTERNAL job id until a connector resolves it to a kp job
 * — the caller substitutes the real one; leaving it null instead would silently detach the
 * candidate from their role.
 */
export function toAtsEntryInput(
  inbound: AtsInboundCandidate,
  opts: { entryId: string; kpJobId?: string | null; stageFallback?: PipelineStage } = { entryId: "" }
) {
  const stage = inbound.stage ?? opts.stageFallback ?? "Accepted";
  return {
    id: opts.entryId,
    candidateId: null,
    candidateLabel: inbound.displayName,
    jobId: opts.kpJobId ?? inbound.externalJobId,
    jobTitle: inbound.jobTitle,
    stage,
    status: "active",
    matchScore: null,
    roleFamily: null,
    archetype: null,
    contact: inbound.contact,
    createdAt: inbound.appliedAt,
    stageChangedAt: inbound.appliedAt,
  };
}

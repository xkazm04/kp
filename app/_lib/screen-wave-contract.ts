// The ONE wire contract of /api/decisions/screen-wave, shared by the server that
// produces it (screen-wave.ts, screen-wave-approval.ts, the route) and every client
// that reads it (the Decisions wave modal, its state machine, the simulation walk).
//
// Deliberately IMPORT-FREE, so it is client-safe by construction:
// screen-wave-approval.ts needs node:crypto and screen-wave.ts needs the DB, so
// neither can be value-imported into a browser bundle, and before this module
// existed the client kept hand mirrors that drifted (a bare-string reasonCode, a
// `holdout` count the server never sent). A new reason code or refusal reason is
// added HERE and becomes a type error in every consumer.
// screen-wave-contract.test.ts pins that this file has no import statement.
//
// Closed vocabularies follow the house shape: literal array + derived union +
// runtime guard. The readers (`readWaveResult`, `readWaveRefusal`) are the only
// way a client turns a response body into these types: nothing is cast.

// ---- reason codes ------------------------------------------------------------------

/** The closed set of rationale shapes. Each maps to a `decisions.wave.reasons.*`
 *  catalog key (`reject` renders as rejectWould / rejectDid); params carry the
 *  interpolated numbers. */
export const SCREEN_REASON_CODES = [
  "autoRejectOff",
  "earlyCareer",
  "unknownArchetype",
  "tieAtCutoff",
  "aboveCutoff",
  "atThreshold",
  "reject",
  "staleSkipped",
  "unscored",
  // A recruiter reversed an earlier auto-rejection on this entry, which returned it
  // to active/Screened, the wave's own cohort predicate. Spared so the machine
  // can't immediately re-reject (and re-email) someone a human deliberately rescued.
  "reinstated",
  // The tamper-evident Art. 22 record could not be written, so the rejection was
  // NOT applied (seal-first ordering in screen-wave.ts).
  "sealFailed",
  // Spared from a would-be auto-reject to form the calibration clean arm.
  "holdout",
  // Spared like a holdout, but the clean-arm SEAL failed, so the candidate is NOT in
  // the calibration arm and the row must not claim to be.
  "holdoutSealFailed",
] as const;
export type ScreenReasonCode = (typeof SCREEN_REASON_CODES)[number];
export function isScreenReasonCode(value: unknown): value is ScreenReasonCode {
  return typeof value === "string" && (SCREEN_REASON_CODES as readonly string[]).includes(value);
}

// ---- the decision and the result, as the server emits them -------------------------

export type ScreenReasonParams = Record<string, string | number>;

export type ScreenDecision = {
  entryId: string;
  label: string;
  archetype: string | null;
  // null = the candidate has no match score (never measured). Such candidates are
  // always `action: "keep"` with reasonCode "unscored": a fabricated 0 must never
  // reach a threshold, a preview row, or a sealed record (SD-L1-002).
  matchScore: number | null;
  action: "reject" | "keep";
  // The audit-trail rationale: byte-identical English, persisted on a committed
  // run and pinned by the unit tests.
  rationale: string;
  // DEC4: a structured, locale-renderable mirror of `rationale`. The modal renders
  // `decisions.wave.reasons.<reasonCode>` with `reasonParams`, so a Czech recruiter
  // reads a Czech rationale while the persisted audit string stays English.
  reasonCode: ScreenReasonCode;
  reasonParams: ScreenReasonParams;
  /** Set on a committed reject whose rejection email failed to queue: the candidate
   *  is out of the funnel and needs a manual nudge. */
  commsFailed?: boolean;
  /** Direction 2 (queue-staleness): this candidate's score predates the JD's last
   *  content edit (`staleSince`). Informs, never blocks. Absent = no stale chrome. */
  stale?: boolean;
  staleSince?: string;
};

/** What the route sends on a 200 (the server additionally includes its resolved
 *  `config`, which no client reads). */
export type ScreenWaveResult = {
  decisions: ScreenDecision[];
  rejected: number;
  kept: number;
  cohort: number;
  /** Rejections applied whose candidate notification failed to queue. 0 on a dry run. */
  commsFailures: number;
  /** Would-be rejects NOT applied because their Art. 22 record could not be sealed.
   *  Required: a result without it used to paint a clean commit while the chain
   *  missed rows. 0 on a dry run. */
  sealFailures: number;
  /** True for a PREVIEW (DEC2): the full ranking / fairness / tie-break math ran,
   *  but no status flipped, no email queued, no audit event written. */
  dryRun: boolean;
  /** Signature of the exact set this run would reject; the commit echoes it. */
  approvalToken: string;
};

// ---- the same shapes, as a client may trust them after reading ---------------------

/** A decision after `readWaveResult`: an unknown reason code (a newer server, an old
 *  fixture) is `null`, rendered from the English `rationale`, never cast into the union. */
export type ScreenDecisionRead = Omit<ScreenDecision, "reasonCode"> & { reasonCode: ScreenReasonCode | null };

export type ScreenWaveRead = Omit<ScreenWaveResult, "decisions" | "approvalToken"> & {
  decisions: ScreenDecisionRead[];
  /** Absent when the body carried none; a commit without one is refused `required`. */
  approvalToken?: string;
};

export type WaveReadOutcome = { ok: true; result: ScreenWaveRead } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readParams(value: unknown): ScreenReasonParams {
  const out: ScreenReasonParams = {};
  if (!isRecord(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" || isCount(v)) out[k] = v;
  }
  return out;
}

function readDecision(value: unknown): ScreenDecisionRead | null {
  if (!isRecord(value)) return null;
  const { entryId, label, archetype, matchScore, action, rationale } = value;
  if (typeof entryId !== "string" || typeof label !== "string" || typeof rationale !== "string") return null;
  if (action !== "reject" && action !== "keep") return null;
  const score = matchScore === null ? null : isCount(matchScore) ? matchScore : undefined;
  if (score === undefined) return null;
  if (archetype !== null && archetype !== undefined && typeof archetype !== "string") return null;
  const d: ScreenDecisionRead = {
    entryId,
    label,
    archetype: typeof archetype === "string" ? archetype : null,
    matchScore: score,
    action,
    rationale,
    reasonCode: isScreenReasonCode(value.reasonCode) ? value.reasonCode : null,
    reasonParams: readParams(value.reasonParams),
  };
  if (value.commsFailed === true) d.commsFailed = true;
  if (value.stale === true) d.stale = true;
  if (typeof value.staleSince === "string") d.staleSince = value.staleSince;
  return d;
}

/** Turn a 200 body into a trusted result, or refuse it. A body missing a count or
 *  carrying a malformed row is `{ok:false}`: never a fabricated clean result with
 *  `sealFailures: 0` painted over a chain that missed rows. */
export function readWaveResult(payload: unknown): WaveReadOutcome {
  if (!isRecord(payload) || !Array.isArray(payload.decisions)) return { ok: false };
  const { rejected, kept, cohort, commsFailures, sealFailures, dryRun, approvalToken } = payload;
  if (!isCount(rejected) || !isCount(kept) || !isCount(cohort) || !isCount(commsFailures) || !isCount(sealFailures)) {
    return { ok: false };
  }
  if (typeof dryRun !== "boolean") return { ok: false };
  const decisions: ScreenDecisionRead[] = [];
  for (const raw of payload.decisions) {
    const d = readDecision(raw);
    if (!d) return { ok: false };
    decisions.push(d);
  }
  const result: ScreenWaveRead = { decisions, rejected, kept, cohort, commsFailures, sealFailures, dryRun };
  if (typeof approvalToken === "string" && approvalToken !== "") result.approvalToken = approvalToken;
  return { ok: true, result };
}

// ---- approval refusals (the 409s) --------------------------------------------------

/** WHY a commit was refused at the approval gate. The five refusals ask the recruiter
 *  for five different things (approve the set / re-preview a changed set / re-preview
 *  an aged review / stop re-committing a review already spent / sign in or set
 *  KP_OPERATOR_NAME), so the 409 body carries this machine half beside the code. */
export const SCREEN_WAVE_REFUSAL_REASONS = ["required", "expired", "mismatch", "spent", "unattributed"] as const;
export type ScreenWaveRefusalReason = (typeof SCREEN_WAVE_REFUSAL_REASONS)[number];
export function isScreenWaveRefusalReason(value: unknown): value is ScreenWaveRefusalReason {
  return typeof value === "string" && (SCREEN_WAVE_REFUSAL_REASONS as readonly string[]).includes(value);
}

/** The historical catch-all, and ScreenWaveApprovalError's default: an older server
 *  (or a body with no readable reason) keeps the pre-existing "re-preview" meaning. */
export const DEFAULT_SCREEN_WAVE_REFUSAL: ScreenWaveRefusalReason = "mismatch";

/** Which approval refusal a response is, or null when it is not one (only a 409 is). */
export function readWaveRefusal(status: number, body: unknown): ScreenWaveRefusalReason | null {
  if (status !== 409) return null;
  const reason = isRecord(body) ? body.reason : undefined;
  return isScreenWaveRefusalReason(reason) ? reason : DEFAULT_SCREEN_WAVE_REFUSAL;
}

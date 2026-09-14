// The seven stage artifacts of a role run, and the rule that keeps them free of
// candidate PII. ADR-0009 (docs/architecture/decisions/0009-one-role-runs-end-to-end.md).
//
// Pure and DB-free on purpose — the same reason screen-wave-approval.ts is: the
// artifact vocabulary and the PII rule are the two things every other module in the
// run agrees on, and they must be unit-testable without dragging better-sqlite3 into
// the test process (and without a client component that imports a stage kind pulling
// the whole store graph into the browser bundle).
//
// The ledger's central claim, from ADR-0009 §1: an artifact REFERENCES store rows, it
// never copies them. `jobs`, `pipeline_entries`, `dev_cases`, `schedule_invites`,
// `offers` stay the single source of truth for their own domain; a stage artifact
// records only what this run did, to which references, and when.

import { type ApprovalKind } from "./approval-kinds.ts";

/** The seven artifact kinds, in the order a run produces them (ADR-0009 §2, S0..S6).
 *  Order is load-bearing: `nextRoleRunStage` is the whole "what happens next" rule,
 *  so a stage inserted in the wrong place changes the run rather than extending it. */
export const ROLE_RUN_STAGES = [
  "role_spec", // S0 — JD ingest
  "slate", // S1 — sourcing
  "screen", // S2 — screening
  "case_assignment", // S3 — case
  "interview", // S4 — scheduling
  "scorecard", // S5 — scorecard synthesis
  "offer_draft", // S6 — offer DRAFT (never a minted offer; see ADR-0009 Consequences)
] as const;

export type RoleRunStageKind = (typeof ROLE_RUN_STAGES)[number];

export function isRoleRunStageKind(value: unknown): value is RoleRunStageKind {
  return typeof value === "string" && (ROLE_RUN_STAGES as readonly string[]).includes(value);
}

export function roleRunStageIndex(kind: string): number {
  return (ROLE_RUN_STAGES as readonly string[]).indexOf(kind);
}

/** The stage that follows `kind`, or null when `kind` is the last one. Null means
 *  "this branch has nothing left to produce", not "the branch failed". */
export function nextRoleRunStage(kind: RoleRunStageKind): RoleRunStageKind | null {
  return ROLE_RUN_STAGES[roleRunStageIndex(kind) + 1] ?? null;
}

/** S0 and S1 are RUN-WIDE: there is one role spec and one slate per run. Everything
 *  from S2 on is per-candidate, which is what makes §4 of the ADR possible — one
 *  candidate parked at a gate holds that candidate's branch and nobody else's. */
export const RUN_WIDE_STAGES: readonly RoleRunStageKind[] = ["role_spec", "slate"];

export function isRunWideStage(kind: RoleRunStageKind): boolean {
  return RUN_WIDE_STAGES.includes(kind);
}

// --- THE THREE GATES (ADR-0009 §3) -------------------------------------------
//
// A gate is a decision ABOUT A PERSON THAT THE PERSON WOULD FEEL. There are exactly
// three, and the operator accepted that list as written on 2026-09-14. Everything
// else — sourcing, scoring, case design, slot generation, scorecard synthesis, and
// the DRAFTING of an offer — runs unattended.
//
// `screening_review` and `scorecard_review` stay in APPROVAL_KINDS as a recruiter's
// own escalation. They are deliberately NOT here: a kind a recruiter may raise is not
// the same thing as a transition the run waits on.

/** The approval kind a stage's gate raises, or null when the stage is unattended.
 *  Exhaustive over RoleRunStageKind, so adding a stage without deciding whether a
 *  human is felt by it is a compile error rather than a silently-ungated step. */
export const STAGE_GATE: Record<RoleRunStageKind, ApprovalKind | null> = {
  role_spec: null,
  slate: null,
  // The rejection gate. S2 proposes rejections; it never commits one.
  screen: "rejection_review",
  case_assignment: null,
  // The invite gate. The run drafts the invite; the gate commit mints the token.
  interview: "calendar",
  scorecard: null,
  // The offer gate. The run drafts terms; the gate commit calls createOffer.
  offer_draft: "offer_review",
};

/** Whether reaching `kind` parks the branch on a human. */
export function stageIsGated(kind: RoleRunStageKind): boolean {
  return STAGE_GATE[kind] !== null;
}

// --- ARTIFACT STATUS ---------------------------------------------------------

/** What an appended artifact says about its branch.
 *   - `complete`           — the stage produced its output and the branch may proceed.
 *   - `awaiting_approval`  — the stage produced a PROPOSAL and a human must commit it.
 *   - `terminal`           — this branch is over (rejected, withdrawn, lapsed, hired).
 *  There is no `running`: an artifact is only written once the stage has produced
 *  something, so a run with no artifact for a stage has simply not reached it. That is
 *  what makes resume a read rather than a reconciliation. */
export const ROLE_RUN_STAGE_STATUSES = ["complete", "awaiting_approval", "terminal"] as const;
export type RoleRunStageStatus = (typeof ROLE_RUN_STAGE_STATUSES)[number];

export function isRoleRunStageStatus(value: unknown): value is RoleRunStageStatus {
  return typeof value === "string" && (ROLE_RUN_STAGE_STATUSES as readonly string[]).includes(value);
}

// --- THE PII RULE (ADR-0009 §5) ----------------------------------------------
//
// "A role_run_stage payload may contain identifiers, scores, codes and hashes. It may
// NOT contain a candidate's name, contact, CV text or transcript."
//
// This is the rule that makes consentWithholdsPii() at a read boundary SUFFICIENT:
// if the ledger holds no second copy of the candidate's words, there is no second copy
// to forget to scrub when a consent expires mid-run. So it is enforced at the write,
// by the store, on every append — not documented and hoped for.
//
// It is enforced two ways, because each catches what the other misses:
//   1. A KEY denylist. `candidateLabel`, `contact`, `cvText`, `transcript` are the
//      names the existing stores actually use, so a stage author copying a field
//      across from a PipelineEntry hits this immediately.
//   2. A VALUE shape check for the two contact forms that are unmistakable wherever
//      they appear — an email address and a long digit run — because a denylist only
//      catches the keys somebody thought of, and `meta: { note: "call +420..." }` is
//      exactly the shape nobody thinks of.
//
// What it deliberately does NOT do is guess at prose. A free-text heuristic would
// reject legitimate reason codes and rationale references, and a guard that cries
// wolf gets disabled. Prose is kept out by the reference discipline (an artifact
// stores a `rationaleRef`, not a rationale), which the key denylist enforces.

/** Field names that may never appear in a stage payload, at any depth. Matched
 *  case-insensitively against the key, and also as a substring for the four roots
 *  below (so `candidateName`, `contact_email`, `cv_text`, `transcriptJson` are all
 *  caught without enumerating every casing a stage author might pick). */
const PII_KEY_ROOTS = ["name", "email", "phone", "contact", "address", "cv", "resume", "transcript", "label"] as const;

/** Keys that contain a denied ROOT as a substring but are not PII — the reference
 *  vocabulary the ADR explicitly blesses. Checked first, so `candidateRef` and
 *  `rationaleRef` survive while `candidateName` does not. Exact, lowercased. */
const PII_KEY_ALLOW = new Set([
  "kind", // "kind" ends in ...nd, not a root — listed for the reader, harmless
  "rubricversion",
  "rubrickeys",
  "reasoncode",
  "reasonparams",
  "policyversion",
  "cvhash", // a hash OF a CV is a code, not the CV
  "resumehash",
]);

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
// Seven or more digits, ignoring the separators a phone number is written with, and
// DELIMITED by a non-word character or a string boundary on both sides.
//
// The delimiters are the whole design. An undelimited "7+ digits" rule flags a hex
// hash — a 32-char sha256 slice contains a run of seven digits more often than not,
// and this module mints several — so the guard would have fired on its own payloads
// and been turned off within a day. Requiring the run to stand alone keeps
// "a1234567b" (a hash) clear while "call +420 123 456 789" is caught. Applied to
// STRINGS only: a score is a number, not a string, and never reaches here.
const PHONE_RE = /(?:^|[^\w])\+?\d(?:[\s\-().]*\d){6,}(?:[^\w]|$)/;

export type PiiViolation = { path: string; reason: "denied_key" | "email_value" | "phone_value" };

/** Every PII rule violation in `payload`, with the JSON path that carries it. Empty
 *  array = the payload is storable. Returned rather than thrown so a caller can report
 *  all of them at once; the store throws on the first non-empty result. */
export function findStagePayloadPii(payload: unknown, basePath = "$"): PiiViolation[] {
  const out: PiiViolation[] = [];
  const walk = (node: unknown, path: string): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (EMAIL_RE.test(node)) out.push({ path, reason: "email_value" });
      else if (PHONE_RE.test(node)) out.push({ path, reason: "phone_value" });
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      const childPath = `${path}.${key}`;
      if (!PII_KEY_ALLOW.has(lower) && !lower.endsWith("ref") && !lower.endsWith("refs") && !lower.endsWith("id") && !lower.endsWith("ids")) {
        if (PII_KEY_ROOTS.some((root) => lower.includes(root))) {
          out.push({ path: childPath, reason: "denied_key" });
          continue; // the key is already a violation; its subtree adds no information
        }
      }
      walk(value, childPath);
    }
  };
  walk(payload, basePath);
  return out;
}

/** Thrown by the store when a stage tries to write PII into the ledger. Carries the
 *  offending paths because "your payload has PII" without saying where is an error a
 *  stage author cannot act on. */
export class RoleRunPiiError extends Error {
  readonly violations: PiiViolation[];
  constructor(violations: PiiViolation[]) {
    super(
      `role_run_stage payload carries candidate PII (ADR-0009 §5): ${violations
        .map((v) => `${v.path} (${v.reason})`)
        .join(", ")}`
    );
    this.name = "RoleRunPiiError";
    this.violations = violations;
  }
}

/** The write-side gate. Throws RoleRunPiiError when `payload` breaks the rule. */
export function assertStagePayloadPiiFree(payload: unknown): void {
  const violations = findStagePayloadPii(payload);
  if (violations.length > 0) throw new RoleRunPiiError(violations);
}

// --- PAYLOAD SHAPES (ADR-0009 §2) --------------------------------------------
//
// Declared as types rather than validated at runtime: the PII rule is the invariant
// that has to hold for a payload written by ANY caller (including a future route), and
// it is checked. The shape is a compile-time contract between the stage runners and
// the readers, both of which are in this repo.

export type RoleSpecPayload = {
  jobId: string;
  roleSpecHash: string;
  rubricVersion: string;
  rubricKeys: string[];
  lintFindings: string[];
};

export type SlateOrigin = "inbound" | "pool" | "rediscovery" | "agent";

export type SlatePayload = {
  candidates: { candidateRef: string; origin: SlateOrigin; priorOutcomeRef?: string }[];
  truncated: boolean;
};

export type ScreenRoute = "advance" | "hold" | "reject_proposed";

export type ScreenPayload = {
  decisions: { entryId: string; route: ScreenRoute; matchScore: number | null; reasonCode: string; reasonParams: Record<string, string | number> }[];
  policyVersion: string;
  fairnessAlerts: string[];
};

export type CaseAssignmentPayload = {
  assignments: { entryId: string; devcaseId: string | null; timeboxMinutes: number; seedRef: string }[];
  caseDesignHash: string;
};

export type InterviewPayload = {
  invites: { entryId: string; inviteRef: string | null; status: string; slotAt: string | null; rescheduleCount: number }[];
};

export type ScorecardPayload = {
  cards: { entryId: string; sessionId: string | null; recommendation: string; rubricVersion: string; rubricKeys: string[]; source: "ai" }[];
};

export type OfferTermsRef = { band: string; currency: string; ttlDays: number };

export type OfferDraftPayload = {
  drafts: { entryId: string; terms: OfferTermsRef; ttlDays: number; rationaleRef: string }[];
};

/** The payload type for each kind, so a reader can narrow off the artifact's kind. */
export type StagePayloadFor<K extends RoleRunStageKind> = K extends "role_spec"
  ? RoleSpecPayload
  : K extends "slate"
    ? SlatePayload
    : K extends "screen"
      ? ScreenPayload
      : K extends "case_assignment"
        ? CaseAssignmentPayload
        : K extends "interview"
          ? InterviewPayload
          : K extends "scorecard"
            ? ScorecardPayload
            : OfferDraftPayload;

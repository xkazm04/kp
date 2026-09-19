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

// --- THE TRANSITION TABLE AND THE RESUME READ (ADR-0009 §1) ------------------
//
// "Resuming a run is re-reading its last artifact." This section is that sentence as
// code: which artifact may legally follow which, and — given nothing but the artifact
// rows the store holds — what a chain is owed next. It is pure on purpose. A resume
// rule that needs the engine's memory, or even a database handle, is a rule a restart
// can disagree with; one that reads rows alone makes a crash, a `next start`, the
// 20-minute pass ceiling and a candidate who answers on Thursday the same case.

/** One artifact's position on its chain: its kind and what it said. */
export type RoleRunStageState = `${RoleRunStageKind}:${RoleRunStageStatus}`;

/** Where a chain stands. `start` is the run-wide chain before its first artifact; a
 *  candidate branch with no artifacts stands at the run-wide `slate:complete`, which is
 *  the fan-out. */
export type RoleRunChainHead = "start" | RoleRunStageState;

/** The legal transition table: for each position, the states that may be appended
 *  next on the same chain. Written out rather than derived, so the rule a reviewer
 *  reads is the rule that runs; role-run-stages.test.ts pins it against ROLE_RUN_STAGES
 *  and STAGE_GATE so it cannot drift from either.
 *
 *  Keyed by every (kind, status) pair, so adding a stage or a status without deciding
 *  what may follow it is a compile error. Three rules shape it:
 *   - A GATED stage's first artifact is `awaiting_approval`, and only a resolution of
 *     the same kind (`complete` or `terminal`) may follow it. A gated stage written
 *     straight to `complete` is the gate skipped, so it is unreachable.
 *   - An UNGATED per-candidate stage is only ever `complete`. Ending a candidacy is felt
 *     by the candidate (ADR-0009 §3: "any later stage that would end a candidacy"), so
 *     it happens at a gate, never as a side effect of a case or a scorecard.
 *   - A run-wide stage may be `terminal` (the job is gone). That ends the run, and it
 *     is a fact about an opening, not a decision about a person. */
export const ROLE_RUN_TRANSITIONS: Readonly<Record<RoleRunChainHead, readonly RoleRunStageState[]>> = {
  start: ["role_spec:complete", "role_spec:terminal"],
  "role_spec:complete": ["slate:complete", "slate:terminal"],
  "role_spec:awaiting_approval": [],
  "role_spec:terminal": [],
  // The fan-out. After the slate the run-wide chain is over, and every candidate branch
  // chains off this position instead of `start`.
  "slate:complete": ["screen:awaiting_approval"],
  "slate:awaiting_approval": [],
  "slate:terminal": [],
  "screen:awaiting_approval": ["screen:complete", "screen:terminal"],
  "screen:complete": ["case_assignment:complete"],
  "screen:terminal": [],
  "case_assignment:complete": ["interview:awaiting_approval"],
  "case_assignment:awaiting_approval": [],
  "case_assignment:terminal": [],
  "interview:awaiting_approval": ["interview:complete", "interview:terminal"],
  "interview:complete": ["scorecard:complete"],
  "interview:terminal": [],
  "scorecard:complete": ["offer_draft:awaiting_approval"],
  "scorecard:awaiting_approval": [],
  "scorecard:terminal": [],
  "offer_draft:awaiting_approval": ["offer_draft:complete", "offer_draft:terminal"],
  // An approved offer gate. Nothing follows it on the ledger: the run drafts, and the
  // gate commit is what mints.
  "offer_draft:complete": [],
  "offer_draft:terminal": [],
};

export function stageStateOf(artifact: { kind: RoleRunStageKind; status: RoleRunStageStatus }): RoleRunStageState {
  return `${artifact.kind}:${artifact.status}`;
}

export function isLegalRoleRunTransition(from: RoleRunChainHead, to: RoleRunStageState): boolean {
  return ROLE_RUN_TRANSITIONS[from].includes(to);
}

/** The fields of an artifact row the resume read needs. Structural, so the store's
 *  RoleRunStageArtifact satisfies it and this module stays DB-free. */
export type RoleRunArtifactRow = {
  kind: RoleRunStageKind;
  status: RoleRunStageStatus;
  /** null = the run-wide chain; an entry id = that candidate's branch. */
  branchRef: string | null;
  /** The run's own clock (db/role-runs.ts). The read orders by it, never by array order. */
  seq: number;
};

export type RoleRunTransitionViolation = {
  seq: number;
  branchRef: string | null;
  state: RoleRunStageState;
  /** Where the chain stood when this artifact was appended. */
  after: RoleRunChainHead;
  reason:
    | "unreachable" // the table has no edge from `after` to `state`
    | "wrong_chain" // a run-wide kind on a branch, or a per-candidate kind on the run-wide chain
    | "before_fan_out"; // a branch artifact appended before the run-wide slate completed
};

export type RoleRunChainReplay = {
  /** Where the chain stands after every legal artifact. */
  head: RoleRunChainHead;
  /** The legal states the chain passed through, oldest first. */
  states: RoleRunStageState[];
  violations: RoleRunTransitionViolation[];
};

function chainRows(artifacts: readonly RoleRunArtifactRow[], branchRef: string | null): RoleRunArtifactRow[] {
  return artifacts.filter((a) => a.branchRef === branchRef).sort((a, b) => a.seq - b.seq);
}

function replayRows(
  rows: readonly RoleRunArtifactRow[],
  branchRef: string | null,
  initial: RoleRunChainHead,
  fanOutSeq: number | null
): RoleRunChainReplay {
  const replay: RoleRunChainReplay = { head: initial, states: [], violations: [] };
  for (const row of rows) {
    const state = stageStateOf(row);
    const violation = (reason: RoleRunTransitionViolation["reason"]) =>
      replay.violations.push({ seq: row.seq, branchRef, state, after: replay.head, reason });
    // An illegal row is reported and SKIPPED, so the rows after it are still judged
    // against the last position the chain legally reached rather than all cascading.
    if (isRunWideStage(row.kind) !== (branchRef === null)) {
      violation("wrong_chain");
    } else if (branchRef !== null && (fanOutSeq === null || row.seq < fanOutSeq)) {
      violation("before_fan_out");
    } else if (!isLegalRoleRunTransition(replay.head, state)) {
      violation("unreachable");
    } else {
      replay.head = state;
      replay.states.push(state);
    }
  }
  return replay;
}

function replayRunWide(artifacts: readonly RoleRunArtifactRow[]): RoleRunChainReplay & { fanOutSeq: number | null } {
  const rows = chainRows(artifacts, null);
  const replay = replayRows(rows, null, "start", null);
  const fanOut = replay.head === "slate:complete" ? rows.find((r) => stageStateOf(r) === "slate:complete") : undefined;
  return { ...replay, fanOutSeq: fanOut?.seq ?? null };
}

/** Replay one chain — `branchRef` null for the run-wide chain — from artifact rows alone.
 *  A branch is judged against the run-wide chain it fanned out from, so a branch row
 *  appended before the slate completed is a violation even if the slate completed later. */
export function replayRoleRunChain(artifacts: readonly RoleRunArtifactRow[], branchRef: string | null): RoleRunChainReplay {
  const runWide = replayRunWide(artifacts);
  if (branchRef === null) return { head: runWide.head, states: runWide.states, violations: runWide.violations };
  return replayRows(chainRows(artifacts, branchRef), branchRef, "slate:complete", runWide.fanOutSeq);
}

/** Every artifact in a run that the transition table says could not exist, across the
 *  run-wide chain and every branch. Empty = the ledger is a chain the engine could have
 *  written. The contract test runs this over real runs; a caller can run it over a
 *  ledger before trusting it. */
export function findRoleRunTransitionViolations(artifacts: readonly RoleRunArtifactRow[]): RoleRunTransitionViolation[] {
  const branches = [...new Set(artifacts.map((a) => a.branchRef).filter((b): b is string => b !== null))];
  return [
    ...replayRoleRunChain(artifacts, null).violations,
    ...branches.flatMap((b) => replayRoleRunChain(artifacts, b).violations),
  ].sort((a, b) => a.seq - b.seq);
}

/** The stages a chain has completed, read from its rows and nothing else. A branch
 *  counts the run-wide stages it fanned out from. This is the only answer to "has this
 *  stage completed" — a stage with no `complete` row on the legal replay has not. */
export function completedStagesFor(artifacts: readonly RoleRunArtifactRow[], branchRef: string | null): RoleRunStageKind[] {
  const own = replayRoleRunChain(artifacts, branchRef).states;
  const inherited = branchRef === null ? [] : replayRoleRunChain(artifacts, null).states;
  return [...inherited, ...own].filter((s) => s.endsWith(":complete")).map((s) => s.slice(0, s.indexOf(":")) as RoleRunStageKind);
}

/** What a chain is owed next. */
export type RoleRunNextStage =
  /** Run this stage's runner and append what it returns. */
  | { action: "produce"; kind: RoleRunStageKind }
  /** Parked on a human: nothing runs until the gate commit appends the resolution. */
  | { action: "await_gate"; kind: RoleRunStageKind; approvalKind: ApprovalKind }
  /** A branch asked about before the run-wide chain reached the slate. */
  | { action: "await_fan_out" }
  | { action: "done"; reason: "run_terminal" | "fanned_out" | "branch_terminal" | "offer_approved" }
  /** The ledger holds a row the transition table forbids. Nothing is advanced over a
   *  chain whose history cannot be true — ADR-0008: a state the rows cannot back is not
   *  read as progress. */
  | { action: "invalid"; violations: RoleRunTransitionViolation[] };

/** THE RESUME READ. Turns "what artifacts exist" into "what runs next", from the rows
 *  alone — no cursor column, no in-memory progress, no database handle. `branchRef`
 *  null asks about the run-wide chain (role spec, slate); an entry id asks about that
 *  candidate's branch. Pass every artifact of the run: the function selects the chain. */
export function nextStageFor(artifacts: readonly RoleRunArtifactRow[], branchRef: string | null = null): RoleRunNextStage {
  const runWide = replayRunWide(artifacts);
  // A corrupt run-wide chain makes every branch's premise unknown, so it poisons them all.
  if (runWide.violations.length > 0) return { action: "invalid", violations: runWide.violations };
  if (runWide.head.endsWith(":terminal")) return { action: "done", reason: "run_terminal" };

  if (branchRef === null) {
    if (runWide.head === "slate:complete") return { action: "done", reason: "fanned_out" };
    return headAction(runWide.head);
  }

  if (runWide.head !== "slate:complete") return { action: "await_fan_out" };
  const branch = replayRows(chainRows(artifacts, branchRef), branchRef, "slate:complete", runWide.fanOutSeq);
  if (branch.violations.length > 0) return { action: "invalid", violations: branch.violations };
  if (branch.head.endsWith(":terminal")) return { action: "done", reason: "branch_terminal" };
  if (branch.head === "offer_draft:complete") return { action: "done", reason: "offer_approved" };
  return headAction(branch.head);
}

function headAction(head: RoleRunChainHead): RoleRunNextStage {
  if (head !== "start" && head.endsWith(":awaiting_approval")) {
    const kind = head.slice(0, head.indexOf(":")) as RoleRunStageKind;
    const approvalKind = STAGE_GATE[kind];
    // Unreachable on a legal chain — only a gated stage can be parked — but a missing
    // gate must never read as "produce": that would advance a branch nobody approved.
    if (approvalKind === null) throw new Error(`role run stage "${kind}" is parked but has no gate`);
    return { action: "await_gate", kind, approvalKind };
  }
  // Every successor of a non-parked position shares one kind (pinned by the test), so
  // the first one names the stage to produce.
  const successor = ROLE_RUN_TRANSITIONS[head][0];
  if (!successor) throw new Error(`role run chain at "${head}" has no successor and is not terminal`);
  return { action: "produce", kind: successor.slice(0, successor.indexOf(":")) as RoleRunStageKind };
}

/** Thrown when a runner returns a status the transition table forbids at that
 *  position — for example a gated stage returned as `complete`, which is the gate
 *  skipped. Raised before the append, so the forbidden row is never written. */
export class RoleRunTransitionError extends Error {
  readonly from: RoleRunChainHead;
  readonly to: RoleRunStageState;
  constructor(from: RoleRunChainHead, to: RoleRunStageState, branchRef: string | null) {
    super(
      `role run transition ${from} → ${to} is not in the transition table (branch ${branchRef ?? "run-wide"}; ADR-0009)`
    );
    this.name = "RoleRunTransitionError";
    this.from = from;
    this.to = to;
  }
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

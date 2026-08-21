// Behavioral coverage for db/pipeline.ts (the highest-blast store) against an
// ISOLATED throwaway DB (testing/unit-db.ts must stay the first project import).
// Pins the state-machine invariants: idempotent creation, one-step advancement
// along the canonical stage axis, CAS guards, terminal-status protection,
// audited stage overrides, rematch close-out, and the GDPR consent lifecycle.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  actOnPipelineEntry,
  anonymizeEntry,
  anonymizeExpiredConsents,
  closeEntriesByJobId,
  createPipelineEntry,
  getPipelineEntry,
  hasEvent,
  listConsentEvents,
  listJobPipelineStats,
  listPipeline,
  listPipelineEventsForEntry,
  PIPELINE_STAGES,
  recordEntryConsent,
  reinstatePipelineEntry,
  rematchSourceEntry,
  setApproval,
  setPipelineEntryStage,
} from "./pipeline.ts";
import { setDecisionConfig } from "../decision-config-store.ts";

after(() => cleanupUnitDb());

let seq = 0;
function addEntry(overrides: Partial<Parameters<typeof createPipelineEntry>[0]> = {}) {
  seq += 1;
  const { entry, created } = createPipelineEntry({
    candidateId: `utest-c${seq}`,
    candidateLabel: `Unit Tester ${seq}`,
    jobId: `utest-job-${seq}`,
    jobTitle: "Unit Test Role",
    ...overrides,
  });
  assert.equal(created, true, "fixture entry should be freshly created");
  return entry;
}

test("createPipelineEntry is idempotent per (candidate, job) and re-activates a terminal re-add", () => {
  const entry = addEntry();
  assert.equal(entry.stage, "Screened", "default stage is Screened");
  assert.equal(entry.status, "active");
  const events = listPipelineEventsForEntry(entry.id);
  assert.deepEqual(events.map((e) => e.kind), ["added"]);

  // Re-add → same row back, created:false, no duplicate 'added' event.
  const again = createPipelineEntry({
    candidateId: `utest-c${seq}`,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId!,
    jobTitle: entry.jobTitle!,
  });
  assert.equal(again.created, false);
  assert.equal(again.entry.id, entry.id);
  assert.equal(listPipelineEventsForEntry(entry.id).length, 1);

  // Close it out, then re-add → the terminal row is re-surfaced as active.
  actOnPipelineEntry(entry.id, "reject");
  assert.equal(getPipelineEntry(entry.id)!.status, "rejected");
  const revived = createPipelineEntry({
    candidateId: `utest-c${seq}`,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId!,
    jobTitle: entry.jobTitle!,
  });
  assert.equal(revived.created, false);
  assert.equal(revived.entry.status, "active");
});

test("accept advances exactly one stage along the canonical axis and Hired is a stage ceiling", () => {
  const entry = addEntry();
  const ladder: string[] = [entry.stage];
  for (let i = 0; i < 3; i++) {
    const next = actOnPipelineEntry(entry.id, "accept");
    assert.ok(next, "accept on an active entry must succeed");
    ladder.push(next.stage);
  }
  assert.deepEqual(ladder, ["Screened", "Interview", "Offer", "Hired"]);
  // The Hired candidate keeps status 'active' (see pipeline-status.ts) and a
  // further accept must NOT overrun the axis or flip anything.
  const atCeiling = actOnPipelineEntry(entry.id, "accept");
  assert.equal(atCeiling!.stage, "Hired");
  assert.equal(atCeiling!.status, "active");
  const advanced = listPipelineEventsForEntry(entry.id).filter((e) => e.kind === "advanced");
  assert.deepEqual(advanced.map((e) => e.toStage), ["Interview", "Offer", "Hired"]);
});

test("accepting a screening_review advances exactly ONE stage and opens the calendar gate — never a double-advance (gsim-l2-101)", () => {
  // The guided sim crashed at the Interview→Offer seam because a bare advance
  // was stacked ON TOP of the screening_review accept: the accept itself IS the
  // advance (one stage + the calendar gate). Pin that composition here so the
  // store's contract — one accept, one stage — can't silently regress.
  const entry = addEntry(); // Screened
  setApproval(entry.id, "screening_review", JSON.stringify({ recommendation: "advance" }));

  const next = actOnPipelineEntry(entry.id, "accept", undefined, { actor: "system" });
  assert.equal(next!.stage, "Interview", "a screening accept moves exactly one stage (Screened → Interview)");
  assert.equal(next!.approvalKind, "calendar", "the interview scheduling gate opens in the same step");

  // Exactly ONE advance event was written, and it is attributed to the ENGINE
  // (actor "system" → auto_advanced), never to a human (gsim-l2-103).
  const advances = listPipelineEventsForEntry(entry.id).filter((e) => e.kind === "advanced" || e.kind === "auto_advanced");
  assert.equal(advances.length, 1, "one accept = one stage advance, no double-advance");
  assert.equal(advances[0].kind, "auto_advanced", "an engine-driven accept must not read as a human decision");
  assert.equal(advances[0].toStage, "Interview");

  // The same accept WITHOUT the actor opt (a real recruiter click) records the
  // human kind — attribution is truthful in both directions.
  const clicked = addEntry();
  setApproval(clicked.id, "screening_review", JSON.stringify({ recommendation: "advance" }));
  const moved = actOnPipelineEntry(clicked.id, "accept");
  assert.equal(moved!.stage, "Interview");
  assert.deepEqual(
    listPipelineEventsForEntry(clicked.id)
      .filter((e) => e.kind === "advanced" || e.kind === "auto_advanced")
      .map((e) => e.kind),
    ["advanced"],
    "a human accept stays a human advance"
  );
});

test("the expectedStage CAS skips a stale decision instead of applying it to the wrong stage", () => {
  const entry = addEntry();
  const skipped = actOnPipelineEntry(entry.id, "accept", undefined, { expectedStage: "Offer" });
  assert.equal(skipped, null, "a decision computed at another stage must be skipped");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Screened", "the stale action must not move the entry");
  // A matching expectation applies normally.
  const applied = actOnPipelineEntry(entry.id, "accept", undefined, { expectedStage: "Screened" });
  assert.equal(applied!.stage, "Interview");
});

test("reject is terminal: accept can't resurrect it; reinstate is the audited way back", () => {
  const entry = addEntry();
  const rejected = actOnPipelineEntry(entry.id, "reject", "not a fit", { actor: "system" });
  assert.equal(rejected!.status, "rejected");
  assert.ok(hasEvent(entry.id, "auto_rejected"), "a system reject records auto_rejected");

  // A stale accept (reused offer/schedule link) must NOT advance a terminal entry.
  assert.equal(actOnPipelineEntry(entry.id, "accept"), null);
  assert.equal(getPipelineEntry(entry.id)!.status, "rejected");

  // Reinstate → active at Screened, audited; a second reinstate is a no-op.
  const restored = reinstatePipelineEntry(entry.id);
  assert.equal(restored!.status, "active");
  assert.equal(restored!.stage, "Screened");
  assert.ok(hasEvent(entry.id, "reinstated"));
  assert.equal(reinstatePipelineEntry(entry.id), null);
});

test("setPipelineEntryStage allows audited backward moves but refuses unknown stages and terminal entries", () => {
  const entry = addEntry({ stage: "Offer" });
  // Backward override (no-show → back to Screened) records a 'moved' event.
  const moved = setPipelineEntryStage(entry.id, "Screened");
  assert.equal(moved!.stage, "Screened");
  const movedEvents = listPipelineEventsForEntry(entry.id).filter((e) => e.kind === "moved");
  assert.equal(movedEvents.length, 1);
  assert.equal(movedEvents[0].fromStage, "Offer");
  assert.equal(movedEvents[0].toStage, "Screened");

  // Unknown stage → refused outright.
  assert.equal(setPipelineEntryStage(entry.id, "Ghosted"), null);

  // Same-stage move is a no-op that returns the entry without a second event.
  const noop = setPipelineEntryStage(entry.id, "Screened");
  assert.equal(noop!.stage, "Screened");
  assert.equal(listPipelineEventsForEntry(entry.id).filter((e) => e.kind === "moved").length, 1);

  // A terminal entry is not reopened by a stage nudge.
  actOnPipelineEntry(entry.id, "reject");
  assert.equal(setPipelineEntryStage(entry.id, "Interview"), null);
});

test("approve_event schedules into Interview but never regresses an entry already past it", () => {
  const entry = addEntry();
  setApproval(entry.id, "calendar", "Tue 14:00");
  const scheduled = actOnPipelineEntry(entry.id, "approve_event", "Wed 10:00");
  assert.equal(scheduled!.stage, "Interview");
  assert.equal(scheduled!.approvalKind, null, "the pending approval is consumed");
  const schedEvents = listPipelineEventsForEntry(entry.id).filter((e) => e.kind === "scheduled");
  assert.equal(schedEvents[0].detail, "Wed 10:00", "the chosen slot override rides the event");

  // A stale schedule link confirmed after the candidate reached Offer records the
  // slot WITHOUT moving them backward.
  const late = addEntry({ stage: "Offer" });
  const kept = actOnPipelineEntry(late.id, "approve_event", "Thu 10:00");
  assert.equal(kept!.stage, "Offer");
  assert.ok(hasEvent(late.id, "scheduled"));
});

test("rematchSourceEntry closes a live source once, leaves terminal sources and hires untouched", () => {
  const source = addEntry();
  const first = rematchSourceEntry(source.id, "target-entry", "target-job");
  assert.deepEqual(first, { closed: true, outcome: "closed" });
  assert.equal(getPipelineEntry(source.id)!.status, "rematched");
  assert.ok(hasEvent(source.id, "rematched"));

  // Re-running against the now-terminal source stamps the link but never re-closes.
  const second = rematchSourceEntry(source.id, "target-entry-2", "target-job-2");
  assert.deepEqual(second, { closed: false, outcome: "already_terminal" });

  // A placed candidate (stage Hired, status active) is never pulled into a rematch.
  const hired = addEntry({ stage: PIPELINE_STAGES[PIPELINE_STAGES.length - 1] });
  assert.deepEqual(rematchSourceEntry(hired.id, "t", "j"), { closed: false, outcome: "hired" });
  assert.equal(hasEvent(hired.id, "rematched"), false, "no rematch link may attach to a hire");

  assert.deepEqual(rematchSourceEntry("no-such-entry", "t", "j"), { closed: false, outcome: "missing" });
});

test("consent lifecycle: grant → renew → anonymize is audited, idempotent, and the sweep only takes expired rows", () => {
  const expired = addEntry({ contact: "expired@example.com" });
  const fresh = addEntry({ contact: "fresh@example.com" });

  // Grant writes 'granted'; a re-grant on the same entry audits 'renewed'.
  const granted = recordEntryConsent(expired.id, "apply", 0); // ttl 0 days → expires immediately
  assert.ok(granted!.consentGivenAt);
  recordEntryConsent(expired.id, "apply", 0);
  assert.deepEqual(
    listConsentEvents(expired.id).map((e) => e.kind).sort(),
    ["granted", "renewed"]
  );
  recordEntryConsent(fresh.id, "apply"); // default TTL — far in the future

  // The sweep anonymizes ONLY the lapsed consent.
  const swept = anonymizeExpiredConsents();
  assert.equal(swept, 1);
  const scrubbed = getPipelineEntry(expired.id)!;
  assert.ok(scrubbed.anonymizedAt, "expired entry is stamped anonymized");
  assert.equal(scrubbed.contact, null, "PII contact is scrubbed");
  assert.notEqual(scrubbed.candidateLabel, expired.candidateLabel, "label is masked");
  const untouched = getPipelineEntry(fresh.id)!;
  assert.equal(untouched.anonymizedAt, null);
  assert.equal(untouched.contact, "fresh@example.com");

  // Anonymization is idempotent — a second pass changes nothing further.
  const again = anonymizeEntry(expired.id);
  assert.equal(again!.anonymizedAt, scrubbed.anonymizedAt);
  assert.equal(anonymizeExpiredConsents(), 0, "already-scrubbed rows leave the sweep");
});

test("listPipeline hides terminal entries from the active board", () => {
  const live = addEntry();
  const closed = addEntry();
  actOnPipelineEntry(closed.id, "reject");
  const board = listPipeline();
  const ids = new Set(board.map((e) => e.id));
  assert.ok(ids.has(live.id), "active entry is on the board");
  assert.ok(!ids.has(closed.id), "rejected entry must not leak back onto the board");
});

// ─── The board axis is per-workspace DATA (Settings → Hiring) ────────────────
// Every test above runs on the shipped five columns, where reading the
// compile-time PIPELINE_STAGES and reading the workspace's own axis give the same
// answer — so none of them can see a stage move that walks the wrong list. These
// do: one workspace composes a board that shares NO ids with the default, and the
// store's moves have to land on ITS columns.
const AXIS_WS = "ws-custom-axis";
const CUSTOM_AXIS = [
  { id: "Inbox", label: "Inbox", role: "entry" },
  { id: "Reviewed", label: "Reviewed", role: "screening" },
  { id: "Onsite", label: "Onsite", role: "interview" },
  { id: "Deciding", label: "Deciding", role: "offer" },
  { id: "Placed", label: "Placed", role: "terminal" },
];
setDecisionConfig("pipelineStages", { stages: CUSTOM_AXIS, retired: [] }, AXIS_WS, "team");

let axisSeq = 0;
function axisEntry(stage: string, jobId = "axis-job") {
  axisSeq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `axis-c${axisSeq}`,
    candidateLabel: `Axis Tester ${axisSeq}`,
    jobId,
    jobTitle: "Axis Role",
    stage,
    workspaceId: AXIS_WS,
  });
  assert.equal(entry.stage, stage);
  return entry;
}

test("an advance walks THIS workspace's board, never the compile-time axis", () => {
  // Standing on a column the shipped list does not contain: indexOf === -1, and
  // `PIPELINE_STAGES[min(-1 + 1, 4)]` is "Accepted" — so an advance used to march
  // the candidate BACKWARD to the front of a funnel their board does not draw.
  const onsite = axisEntry("Onsite");
  const advanced = actOnPipelineEntry(onsite.id, "accept", undefined, undefined, AXIS_WS);
  assert.equal(advanced!.stage, "Deciding", "accept advances one column along the workspace axis");
  const events = listPipelineEventsForEntry(onsite.id, 50, AXIS_WS).filter((e) => e.kind === "advanced");
  assert.deepEqual(events.map((e) => e.toStage), ["Deciding"], "the audit event names the column they actually landed on");

  // The terminal column is the ceiling on this axis too — nothing overruns it.
  const placed = axisEntry("Placed");
  assert.equal(actOnPipelineEntry(placed.id, "accept", undefined, undefined, AXIS_WS)!.stage, "Placed");

  // A screening accept opens the calendar gate one column on, still on this axis.
  const reviewed = axisEntry("Reviewed");
  setApproval(reviewed.id, "screening_review", JSON.stringify({ recommendation: "advance" }), AXIS_WS);
  const screened = actOnPipelineEntry(reviewed.id, "accept", undefined, { actor: "system" }, AXIS_WS);
  assert.equal(screened!.stage, "Onsite");
  assert.equal(screened!.approvalKind, "calendar");
});

test("a confirmed slot lands on the workspace's evaluation column, and a reinstate on its screened column", () => {
  const waiting = axisEntry("Reviewed");
  setApproval(waiting.id, "calendar", "Tue 14:00", AXIS_WS);
  const scheduled = actOnPipelineEntry(waiting.id, "approve_event", "Wed 10:00", undefined, AXIS_WS);
  assert.equal(scheduled!.stage, "Onsite", "scheduling advances to the screening GATE of this board, not the name 'Interview'");

  // …and never backward: past the gate, the slot is recorded in place.
  const late = axisEntry("Deciding");
  setApproval(late.id, "calendar", "Tue 14:00", AXIS_WS);
  assert.equal(actOnPipelineEntry(late.id, "approve_event", "Thu 09:00", undefined, AXIS_WS)!.stage, "Deciding");

  // A reversal puts the candidate back where an already-assessed candidate belongs
  // ON THIS BOARD — parking them on "Screened" would be a column it does not draw.
  const rejected = axisEntry("Reviewed");
  actOnPipelineEntry(rejected.id, "reject", undefined, { actor: "system" }, AXIS_WS);
  const restored = reinstatePipelineEntry(rejected.id, AXIS_WS);
  assert.equal(restored!.stage, "Reviewed");
  assert.equal(
    listPipelineEventsForEntry(rejected.id, 50, AXIS_WS).find((e) => e.kind === "reinstated")?.toStage,
    "Reviewed"
  );
});

test("closing a role spares the candidate it was FILLED with, by role and not by the name 'Hired'", () => {
  const jobId = "axis-close-job";
  const placed = axisEntry("Placed", jobId);
  const inFlight = axisEntry("Reviewed", jobId);

  assert.equal(closeEntriesByJobId(jobId, AXIS_WS), 1, "only the in-flight candidate is withdrawn");
  assert.equal(getPipelineEntry(placed.id, AXIS_WS)!.status, "active", "the hire must never be flipped to role_closed");
  assert.equal(getPipelineEntry(inFlight.id, AXIS_WS)!.status, "role_closed");
});

test("the per-job rollup counts reached-interview and hired on the workspace's own axis", () => {
  const jobId = "axis-stats-job";
  axisEntry("Reviewed", jobId);
  axisEntry("Onsite", jobId);
  axisEntry("Placed", jobId);
  // Read off the shipped five names these all index to -1, so the JD library
  // reported 0 reached-interview / 0 hired while Analytics (which resolves the
  // workspace axis) counted the same rows correctly.
  assert.deepEqual(listJobPipelineStats(AXIS_WS)[jobId], { total: 3, reachedInterview: 2, hired: 1 });
});

test("a requested 'decision' gate (shortlist-to-group-eval) resolves through the normal decide actions — never a stuck pending row", () => {
  // The Match-tab add is the only path that requests approvalKind at creation.
  // Verified lifecycle: the SAME clearing the seeded decision rows get —
  // accept advances one stage and clears the gate; reject closes out and clears
  // the gate. Both run through actOnPipelineEntry (the DecisionsTab act() path),
  // so a Match-filed key decision can always leave the Decisions queue.
  const gated = addEntry({ approvalKind: "decision" });
  assert.equal(gated.approvalKind, "decision", "the requested gate is stamped at creation");
  assert.equal(gated.stage, "Screened");
  assert.equal(gated.status, "active");

  const advanced = actOnPipelineEntry(gated.id, "accept");
  assert.equal(advanced!.stage, "Interview", "accept advances exactly one stage");
  assert.equal(advanced!.approvalKind, null, "accept clears the decision gate");

  const second = addEntry({ approvalKind: "decision" });
  const rejected = actOnPipelineEntry(second.id, "reject");
  assert.equal(rejected!.status, "rejected", "reject closes the entry out");
  assert.equal(rejected!.approvalKind, null, "reject clears the decision gate");

  // Omitting the field keeps every other add path byte-identical: no gate.
  const plain = addEntry();
  assert.equal(plain.approvalKind, null);
});

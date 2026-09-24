// Pure logic for the Gigs tab (gigsLogic.ts): who acts next, the line (arenas by
// lifecycle step), the rate as a fraction, and the desk's Approve gate.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Gig, GigAttempt, GigAttemptStatus, GigKpiCell, GigStatus } from "@/app/_lib/gigs/types.ts";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint.ts";
import {
  checklistKeyFor,
  deadlineView,
  deriveQueue,
  deskGate,
  evidenceState,
  isTypingTarget,
  LINE_STEPS,
  lineRows,
  marksByLine,
  markSentGate,
  matchesSearch,
  needsYou,
  nextNeed,
  overallCell,
  queueCounts,
  queueKindOf,
  rateView,
  reachedStep,
  revealInvisible,
  specialistEdgeIndex,
  splitAround,
  STEP_OWNER,
} from "./gigsLogic.ts";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function gig(id: string, status: GigStatus, p: Partial<Gig> = {}): Gig {
  return {
    id,
    sourceId: null,
    arena: "oss_bounty",
    externalKey: id,
    url: `https://example.test/${id}`,
    title: `Gig ${id}`,
    org: null,
    reward: null,
    deadlineAt: null,
    postedAt: null,
    bodyText: "body",
    tags: [],
    niche: null,
    status,
    suspectReasons: [],
    specialistId: null,
    qualification: null,
    brief: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...p,
  };
}

function att(id: string, gigId: string, status: GigAttemptStatus, p: Partial<GigAttempt> = {}): GigAttempt {
  return {
    id,
    gigId,
    specialistId: "s1",
    executionId: null,
    status,
    deliverable: null,
    fallbackReason: null,
    costUsd: null,
    review: null,
    revisionNote: null,
    sentAt: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...p,
  };
}

test("queueKindOf: each gig lands in exactly the queue of whoever acts next", () => {
  assert.equal(queueKindOf(gig("a", "suspect"), null), "suspect");
  assert.equal(queueKindOf(gig("a", "sent"), att("x", "a", "sent")), "record");
  assert.equal(queueKindOf(gig("a", "drafted"), att("x", "a", "drafted")), "review");
  assert.equal(queueKindOf(gig("a", "in_review"), att("x", "a", "approved")), "review");
  assert.equal(queueKindOf(gig("a", "dispatched"), att("x", "a", "running")), "running");
  assert.equal(queueKindOf(gig("a", "drafted"), att("x", "a", "revision_requested")), "revision");
  assert.equal(queueKindOf(gig("a", "new"), null), "triage");
  assert.equal(queueKindOf(gig("a", "qualified"), null), "triage");
  assert.equal(queueKindOf(gig("a", "qualified"), att("x", "a", "discarded")), "triage");
  assert.equal(queueKindOf(gig("a", "qualified"), att("x", "a", "failed")), "failed");
  for (const s of ["accepted", "rejected", "declined", "expired", "withdrawn"] as const) {
    assert.equal(queueKindOf(gig("a", s), null), null, `${s} needs nobody`);
  }
});

test("deriveQueue groups operator kinds before agent kinds, oldest first; agent work never pads the operator counts", () => {
  const gigs = [
    gig("t1", "new", { createdAt: "2026-09-05T00:00:00.000Z" }),
    gig("r2", "drafted"),
    gig("r1", "drafted"),
    gig("run", "dispatched"),
    gig("t0", "new", { createdAt: "2026-09-02T00:00:00.000Z" }),
    gig("done", "accepted"),
  ];
  const attempts = {
    r1: att("a1", "r1", "drafted", { createdAt: "2026-09-11T00:00:00.000Z" }),
    r2: att("a2", "r2", "drafted", { createdAt: "2026-09-12T00:00:00.000Z" }),
    run: att("a3", "run", "running"),
  };
  const q = deriveQueue(gigs, attempts);
  assert.deepEqual(q.map((i) => i.key), ["review:r1", "review:r2", "triage:t0", "triage:t1", "running:run"]);
  const c = queueCounts(q);
  assert.equal(c.review + c.suspect + c.record + c.triage, 4);
  assert.equal(c.running, 1);
});

test("nextNeed walks the three judgements in order, wraps round, and never offers triage or agent work", () => {
  const gigs = [
    gig("t", "new"),
    gig("s", "suspect", { suspectReasons: ["credential_request"] }),
    gig("r", "drafted"),
    gig("o", "sent"),
    gig("run", "dispatched"),
  ];
  const attempts = { r: att("a1", "r", "drafted"), o: att("a2", "o", "sent"), run: att("a3", "run", "running") };
  const q = deriveQueue(gigs, attempts);
  assert.equal(nextNeed(q, null)!.gig.id, "r");
  assert.equal(nextNeed(q, "r")!.gig.id, "s");
  assert.equal(nextNeed(q, "s")!.gig.id, "o");
  assert.equal(nextNeed(q, "o")!.gig.id, "r", "wraps round");
  assert.equal(nextNeed(q, "t")!.gig.id, "r", "a gig that needs nothing restarts at the first");
  assert.equal(nextNeed(q, null, "record")!.gig.id, "o");
  assert.equal(nextNeed(deriveQueue([gig("t", "new")], {}), null), null);
});

test("lineRows: all four arenas, every canonical step and the three ways off, oldest waiting first", () => {
  const gigs = [
    gig("b", "new", { updatedAt: "2026-09-05T00:00:00.000Z" }),
    gig("a", "new", { updatedAt: "2026-09-02T00:00:00.000Z" }),
    gig("d", "declined", { arena: "security" }),
  ];
  const rows = lineRows(gigs, {});
  assert.deepEqual(rows.map((r) => r.arena), ["security", "freelance", "competition", "oss_bounty"]);
  const oss = rows.find((r) => r.arena === "oss_bounty")!;
  assert.deepEqual(oss.cells.map((c) => c.step), [...LINE_STEPS]);
  assert.deepEqual(oss.cells[0].gigs.map((g) => g.id), ["a", "b"]);
  assert.equal(oss.total, 2);
  const sec = rows.find((r) => r.arena === "security")!;
  assert.deepEqual(sec.off.map((o) => [o.step, o.gigs.length]), [["declined", 1], ["withdrawn", 0], ["expired", 0]]);
  assert.equal(rows.find((r) => r.arena === "freelance")!.total, 0);
});

test("reachedStep separates 'none here now' from 'none reached'", () => {
  const accepted = [gig("x", "accepted")];
  assert.equal(reachedStep(accepted, {}, "drafted"), true, "an accepted gig passed through drafted");
  assert.equal(reachedStep(accepted, {}, "sent"), true);
  assert.equal(reachedStep(accepted, {}, "rejected"), false, "accepted and rejected are alternatives");
  assert.equal(reachedStep(accepted, {}, "suspect"), false, "suspect is a side branch, not a rank");
  const fresh = [gig("n", "new")];
  assert.equal(reachedStep(fresh, {}, "new"), true);
  assert.equal(reachedStep(fresh, {}, "qualified"), false);
  // A declined gig is read off its latest attempt.
  const left = [gig("d", "declined")];
  assert.equal(reachedStep(left, {}, "qualified"), false);
  assert.equal(reachedStep(left, { d: att("a", "d", "sent") }, "sent"), true);
  assert.equal(reachedStep(left, { d: att("a", "d", "failed") }, "dispatched"), true);
  assert.equal(reachedStep(left, { d: att("a", "d", "failed") }, "drafted"), false);
  assert.equal(reachedStep([gig("c", "new", { suspectReasons: ["agent_addressed"] })], {}, "suspect"), true);
  const row = lineRows(accepted, {}).find((r) => r.arena === "oss_bounty")!;
  const drafted = row.cells.find((c) => c.step === "drafted")!;
  assert.deepEqual([drafted.gigs.length, drafted.reached], [0, true]);
});

test("STEP_OWNER: exactly suspect, drafted and sent carry the judgement band", () => {
  assert.deepEqual(LINE_STEPS.filter((s) => STEP_OWNER[s] === "you"), ["suspect", "drafted", "sent"]);
});

test("matchesSearch reads title, org, id, niche and tags; needsYou is the three judgements", () => {
  const g = gig("gig_7", "new", { title: "Rust CLI bounty", org: "Acme", tags: ["tokio"], niche: "cli" });
  for (const q of ["rust", "ACME", "gig_7", "tokio", "cli", "  "]) assert.equal(matchesSearch(g, q), true, q);
  assert.equal(matchesSearch(g, "python"), false);
  assert.equal(needsYou(gig("a", "suspect"), null), true);
  assert.equal(needsYou(gig("a", "drafted"), att("x", "a", "drafted")), true);
  assert.equal(needsYou(gig("a", "sent"), att("x", "a", "sent")), true);
  assert.equal(needsYou(gig("a", "new"), null), false, "triage is not a judgement");
  assert.equal(needsYou(gig("a", "dispatched"), att("x", "a", "running")), false);
});

test("specialistEdgeIndex ranks by hire date, stably", () => {
  const sp = [
    { id: "late", createdAt: "2026-09-03T00:00:00.000Z" },
    { id: "early", createdAt: "2026-09-01T00:00:00.000Z" },
  ];
  assert.equal(specialistEdgeIndex(sp, "early"), 0);
  assert.equal(specialistEdgeIndex(sp, "late"), 1);
  assert.equal(specialistEdgeIndex(sp, "missing"), -1);
});

function cell(p: Partial<GigKpiCell>): GigKpiCell {
  return { resolved: 0, accepted: 0, rate: null, pending: 0, costPerAcceptedUsd: null, costUnreported: 0, smallSample: true, ...p };
}

test("rateView: unmeasured is never 0%; the percent rides only beside its n", () => {
  assert.deepEqual(rateView(cell({ pending: 2 })), { measured: false, accepted: 0, resolved: 0, pending: 2, percent: null, small: true });
  const r = rateView(cell({ resolved: 3, accepted: 1, rate: 1 / 3, pending: 1 }));
  assert.equal(r.percent, 33);
  assert.equal(r.measured, true);
  assert.equal(rateView(null).measured, false);
});

test("overallCell sums the arena partition and re-derives the rate and the small-sample flag", () => {
  const kpi = {
    byArena: {
      security: cell({ resolved: 4, accepted: 1, rate: 0.25, pending: 1, costUnreported: 2 }),
      freelance: cell({ resolved: 6, accepted: 3, rate: 0.5, pending: 0 }),
      competition: cell({}),
      oss_bounty: cell({ pending: 2 }),
    },
  };
  const o = overallCell(kpi);
  assert.equal(o.resolved, 10);
  assert.equal(o.accepted, 4);
  assert.equal(o.pending, 3);
  assert.equal(o.rate, 0.4);
  assert.equal(o.smallSample, false);
  assert.equal(o.costUnreported, 2);
  assert.equal(overallCell({ byArena: { security: cell({}), freelance: cell({}), competition: cell({}), oss_bounty: cell({}) } }).rate, null);
});

test("deadlineView: none, passed, soon (3 days or less), open", () => {
  assert.deepEqual(deadlineView(null, NOW), { state: "none" });
  assert.equal(deadlineView("2026-09-20T00:00:00.000Z", NOW).state, "passed");
  assert.equal(deadlineView("2026-09-26T00:00:00.000Z", NOW).state, "soon");
  assert.equal(deadlineView("2026-10-24T00:00:00.000Z", NOW).state, "open");
  assert.deepEqual(deadlineView("not a date", NOW), { state: "none" });
});

test("evidenceState keeps three states: unverified is not failed", () => {
  assert.equal(evidenceState(true), "passed");
  assert.equal(evidenceState(false), "failed");
  assert.equal(evidenceState(null), "unverified");
});

function finding(id: string, severity: DraftLintFinding["severity"], line: number | null = null): DraftLintFinding {
  return { id, severity, line, messageKey: "doubledWord", params: {} };
}

test("deskGate: blockers first, then the checklist, then unseen warns; info never gates", () => {
  const items = ["a", "b", "disclosure"];
  const findings = [finding("x", "blocker"), finding("w", "warn", 2), finding("i", "info")];
  assert.deepEqual(deskGate(items, {}, findings, new Set()).reason, { kind: "blockers", count: 1 });
  const noBlock = findings.slice(1);
  assert.deepEqual(deskGate(items, { a: true }, noBlock, new Set()).reason, { kind: "checklist", ticked: 1, total: 3 });
  const allTicked = { a: true, b: true, disclosure: true };
  assert.deepEqual(deskGate(items, allTicked, noBlock, new Set()).reason, { kind: "unseen", count: 1 });
  const g = deskGate(items, allTicked, noBlock, new Set(["w"]));
  assert.equal(g.ready, true);
  assert.equal(g.reason, null);
  assert.equal(deskGate(items, { ...allTicked, b: false }, [], new Set()).ready, false);
});

test("markSentGate counts the checklist", () => {
  assert.deepEqual(markSentGate(["a", "disclosure"], { a: true }), { ticked: 1, total: 2, ready: false });
  assert.equal(markSentGate(["a", "disclosure"], { a: true, disclosure: true }).ready, true);
});

test("marksByLine groups line-anchored findings; splitAround finds the excerpt", () => {
  const m = marksByLine([finding("a", "warn", 2), finding("b", "warn", 2), finding("c", "info"), finding("d", "warn", 5)]);
  assert.deepEqual([...m.keys()], [2, 5]);
  assert.equal(m.get(2)!.length, 2);
  assert.deepEqual(splitAround("fix the the bug", "the the"), ["fix ", "the the", " bug"]);
  assert.equal(splitAround("fix", "zzz"), null);
  assert.equal(splitAround("fix", undefined), null);
});

test("revealInvisible turns zero-width and direction controls into visible markers", () => {
  const segs = revealInvisible("pay​me‮now");
  assert.deepEqual(segs, [
    { kind: "text", text: "pay" },
    { kind: "invisible", code: "U+200B" },
    { kind: "text", text: "me" },
    { kind: "invisible", code: "U+202E" },
    { kind: "text", text: "now" },
  ]);
  assert.deepEqual(revealInvisible("plain"), [{ kind: "text", text: "plain" }]);
});

test("isTypingTarget: fields swallow shortcuts, checkboxes do not", () => {
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "text" } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" } as unknown as EventTarget), false);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" } as unknown as EventTarget), false);
  assert.equal(isTypingTarget(null), false);
});

test("checklistKeyFor maps 1-9 onto the arena's items", () => {
  assert.equal(checklistKeyFor("1", ["a", "b"]), "a");
  assert.equal(checklistKeyFor("2", ["a", "b"]), "b");
  assert.equal(checklistKeyFor("3", ["a", "b"]), null);
  assert.equal(checklistKeyFor("j", ["a", "b"]), null);
});

test("QUALIFY_BAR restates qualify.ts's threshold exactly", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../../_lib/gigs/qualify.ts", import.meta.url)), "utf8");
  const m = /export const QUALIFY_THRESHOLD = (\d+);/.exec(src);
  assert.ok(m, "qualify.ts still declares QUALIFY_THRESHOLD");
  const { QUALIFY_BAR } = await import("./gigsLogic.ts");
  assert.equal(QUALIFY_BAR, Number(m[1]));
});

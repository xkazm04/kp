// Pure logic for the Gigs tab (gigsLogic.ts): the judgement queue, the board's
// lifecycle grouping, the rate as a fraction, and the desk's Approve gate.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Gig, GigAttempt, GigAttemptStatus, GigKpiCell, GigStatus } from "@/app/_lib/gigs/types.ts";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint.ts";
import {
  BOARD_STEPS,
  checklistKeyFor,
  deadlineView,
  deriveQueue,
  deskGate,
  evidenceState,
  groupBoard,
  isTypingTarget,
  marksByLine,
  markSentGate,
  overallCell,
  queueCounts,
  queueKindOf,
  rateView,
  revealInvisible,
  selectionAfter,
  splitAround,
  stepSelection,
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

test("stepSelection clamps and starts at the first item", () => {
  const q = deriveQueue([gig("a", "new"), gig("b", "new", { createdAt: "2026-09-02T00:00:00.000Z" })], {});
  assert.equal(stepSelection(q, null, 1), "triage:a");
  assert.equal(stepSelection(q, "triage:a", 1), "triage:b");
  assert.equal(stepSelection(q, "triage:b", 1), "triage:b");
  assert.equal(stepSelection(q, "triage:a", -1), "triage:a");
  assert.equal(stepSelection([], null, 1), null);
});

test("selectionAfter opens the next item of the same kind, then the first operator item", () => {
  const before = deriveQueue(
    [gig("a", "new"), gig("b", "new", { createdAt: "2026-09-02T00:00:00.000Z" }), gig("c", "new", { createdAt: "2026-09-03T00:00:00.000Z" })],
    {}
  );
  const after = before.filter((i) => i.key !== "triage:b");
  assert.equal(selectionAfter(before, after, "triage:b"), "triage:c");
  const afterLast = before.filter((i) => i.key !== "triage:c");
  assert.equal(selectionAfter(before, afterLast, "triage:c"), "triage:b");
  assert.equal(selectionAfter(before, [], "triage:a"), null);
});

test("groupBoard lists every lifecycle step, empty ones included, and filters by search, arena and status", () => {
  const gigs = [gig("a", "new", { title: "Rust CLI bounty", tags: ["rust"] }), gig("b", "sent", { arena: "security", org: "Acme" })];
  const all = groupBoard(gigs, { search: "", arena: "all", status: "all" });
  assert.deepEqual(all.map((s) => s.status), [...BOARD_STEPS]);
  assert.equal(all.find((s) => s.status === "withdrawn")!.gigs.length, 0);
  assert.deepEqual(groupBoard(gigs, { search: "RUST", arena: "all", status: "all" }).flatMap((s) => s.gigs.map((g) => g.id)), ["a"]);
  assert.deepEqual(groupBoard(gigs, { search: "acme", arena: "security", status: "all" }).flatMap((s) => s.gigs.map((g) => g.id)), ["b"]);
  const onlySent = groupBoard(gigs, { search: "", arena: "all", status: "sent" });
  assert.deepEqual(onlySent.map((s) => s.status), ["sent"]);
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

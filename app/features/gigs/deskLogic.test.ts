// Pure logic for the Gigs desk (deskLogic.ts): the front page's urgency order, the whole
// file, niches and lanes, the reviewer agent's note and the margin notes it pins.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Gig, GigAttempt, GigAttemptStatus, GigKpi, GigKpiCell, GigStatus } from "@/app/_lib/gigs/types.ts";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint.ts";
import type { SpecialistRow } from "./gigsLogic.ts";
import {
  afterLeavingList,
  draftParagraphs,
  EMPTY_FILE,
  fileRows,
  firstClosing,
  foldNiches,
  frontColumns,
  laneOfGig,
  laneRows,
  letterKey,
  listNeighbours,
  nextInQueue,
  nicheBySpecialistMap,
  nicheCell,
  nicheTally,
  NO_LANE,
  paragraphSpans,
  parseReviewNote,
  pinNotes,
  programTally,
  quotedPhrases,
  urgencyQueue,
  waitCounts,
} from "./deskLogic.ts";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function gig(id: string, status: GigStatus, p: Partial<Gig> = {}): Gig {
  return {
    id,
    sourceId: null,
    arena: "freelance",
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
    workdir: null,
    personasProjectId: null,
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

function spec(id: string, niche: string, status: string | null, createdAt = "2026-09-20T00:00:00.000Z", arena: Gig["arena"] = "freelance"): SpecialistRow {
  return {
    id,
    hiredAgentId: `agent-${id}`,
    name: `Specialist ${id}`,
    spec: { arena, niche, taxonomyFamily: "x", recipes: [], exemplars: [], connectors: [], budgetUsdPerAttempt: 3, promptVersion: "v1" },
    registry: "available",
    createdAt,
    updatedAt: createdAt,
    hire: status === null ? null : { id: `h-${id}`, status, personaId: null, personaName: null, requestId: null, updatedAt: createdAt, lastReportAt: null },
  } as unknown as SpecialistRow;
}

const cell = (p: Partial<GigKpiCell>): GigKpiCell => ({ resolved: 0, accepted: 0, rate: null, pending: 0, costPerAcceptedUsd: null, costUnreported: 0, smallSample: true, ...p });

test("urgencyQueue: nearest OPEN deadline first; closed and undated after every dated one; ties go to the move closest to done", () => {
  const gigs = [
    gig("undated-ready", "in_review"),
    gig("closed-proof", "drafted", { deadlineAt: inDays(-1) }),
    gig("d5-quar", "suspect", { deadlineAt: inDays(5) }),
    gig("d2-proof", "drafted", { deadlineAt: inDays(2) }),
    gig("d2-ready", "in_review", { deadlineAt: inDays(2) }),
    gig("with-agent", "dispatched", { deadlineAt: inDays(1) }),
    gig("qualified", "qualified", { deadlineAt: inDays(1) }),
  ];
  const q = urgencyQueue(gigs, {}, NOW).map((g) => g.id);
  assert.deepEqual(q.slice(0, 3), ["d2-ready", "d2-proof", "d5-quar"]);
  assert.deepEqual(new Set(q.slice(3)), new Set(["undated-ready", "closed-proof"]), "no deadline and a closed one both sort after the dated work");
  assert.ok(!q.includes("with-agent") && !q.includes("qualified"), "agent work and dispatch-when-you-choose never wait on you");
});

test("frontColumns + waitCounts: the three judgements and the verdicts to record, nothing else", () => {
  const gigs = [gig("a", "in_review"), gig("b", "drafted"), gig("c", "drafted"), gig("d", "suspect"), gig("e", "sent"), gig("f", "new"), gig("g", "dispatched")];
  const cols = frontColumns(gigs, {}, NOW);
  assert.deepEqual(waitCounts(cols), { clear: 1, review: 2, send: 1, record: 1, total: 5 });
});

test("nextInQueue walks the urgency order after the last opened, wrapping; null when nothing waits", () => {
  const q = [gig("a", "in_review"), gig("b", "drafted"), gig("c", "suspect")];
  assert.equal(nextInQueue(q, null)?.id, "a");
  assert.equal(nextInQueue(q, "a")?.id, "b");
  assert.equal(nextInQueue(q, "c")?.id, "a");
  assert.equal(nextInQueue(q, "gone")?.id, "a");
  assert.equal(nextInQueue([], null), null);
});

test("firstClosing names the nearest open deadline in the queue, never a closed one", () => {
  const q = urgencyQueue([gig("closed", "drafted", { deadlineAt: inDays(-2) }), gig("soon", "drafted", { deadlineAt: inDays(2.5) })], {}, NOW);
  assert.deepEqual(firstClosing(q, NOW)?.gig.id, "soon");
  assert.equal(firstClosing(q, NOW)?.days, 2);
  assert.equal(firstClosing([gig("x", "drafted")], NOW), null);
});

test("listNeighbours: no wrap, 1-based index, null when the gig left the list; afterLeavingList lands next, else previous", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(listNeighbours(ids, "a"), { prev: null, next: "b", index: 1, total: 3 });
  assert.deepEqual(listNeighbours(ids, "c"), { prev: "b", next: null, index: 3, total: 3 });
  assert.equal(listNeighbours(ids, "z"), null);
  assert.equal(afterLeavingList(listNeighbours(ids, "b")), "c");
  assert.equal(afterLeavingList(listNeighbours(ids, "c")), "b");
  assert.equal(afterLeavingList(listNeighbours(["a"], "a")), null);
});

test("foldNiches: one lane per arena + niche (normalized), the working hire leads, earlier copies fold", () => {
  const niches = foldNiches([
    spec("old", "Web Development", "retired", "2026-09-20T00:00:00.000Z"),
    spec("new", "web development ", "active", "2026-09-25T00:00:00.000Z"),
    spec("failed", "web  development", "failed", "2026-09-26T00:00:00.000Z"),
    spec("sec", "web development", "active", "2026-09-21T00:00:00.000Z", "security"),
    spec("py", "python", "active"),
  ]);
  assert.equal(niches.length, 3, "the same niche in another arena is its own lane");
  const web = niches.find((n) => n.key === "freelance|web development")!;
  assert.equal(web.lead.id, "new");
  assert.deepEqual(web.earlier.map((h) => h.id), ["old", "failed"]);
});

test("laneOfGig: the latest attempt's specialist, else the routed one, else the unrouted pool", () => {
  const map = nicheBySpecialistMap(foldNiches([spec("s1", "python", "active"), spec("s2", "writing", "active")]));
  assert.equal(laneOfGig(gig("a", "drafted", { specialistId: "s2" }), att("x", "a", "drafted"), map), "freelance|python");
  assert.equal(laneOfGig(gig("b", "qualified", { specialistId: "s2" }), null, map), "freelance|writing");
  assert.equal(laneOfGig(gig("c", "new"), null, map), NO_LANE);
});

test("laneRows: counts by step, verdicts share a column, exits counted apart, 'none here now' vs 'never reached'", () => {
  const niches = foldNiches([spec("s1", "python", "active")]);
  const map = nicheBySpecialistMap(niches);
  const gigs = [
    gig("a", "drafted", { specialistId: "s1" }),
    gig("b", "accepted", { specialistId: "s1" }),
    gig("c", "declined", { specialistId: "s1" }),
    gig("d", "new"),
  ];
  const [lane, pool] = laneRows(gigs, {}, niches, map);
  const at = (row: typeof lane, step: string) => row.cells.find((c) => c.step === step)!;
  assert.equal(at(lane, "drafted").count, 1);
  assert.equal(at(lane, "verdict").count, 1);
  assert.equal(lane.exit, 1);
  assert.equal(at(lane, "qualified").count, 0);
  assert.equal(at(lane, "qualified").reached, true, "a drafted gig passed qualified: none here NOW");
  assert.equal(at(lane, "suspect").reached, false, "nothing in this lane was ever quarantined");
  assert.equal(pool.key, NO_LANE);
  assert.equal(at(pool, "new").count, 1);
});

test("nicheCell sums the hires' KPI cells and re-derives the rate; unmeasured stays null", () => {
  const n = { hires: [spec("a", "x", "active"), spec("b", "x", "retired")] };
  const kpi = { bySpecialist: { a: cell({ resolved: 2, accepted: 1, pending: 1, costPerAcceptedUsd: 4 }), b: cell({ resolved: 1, accepted: 1, costPerAcceptedUsd: 2 }) } } as unknown as GigKpi;
  const c = nicheCell(n, kpi);
  assert.equal(c.resolved, 3);
  assert.equal(c.accepted, 2);
  assert.equal(c.pending, 1);
  assert.equal(c.rate, 2 / 3);
  assert.equal(c.costPerAcceptedUsd, 3);
  assert.equal(nicheCell(n, null).rate, null, "nothing resolved is unmeasured, never 0%");
  const unknownCost = { bySpecialist: { a: cell({ resolved: 1, accepted: 1, costPerAcceptedUsd: null }) } } as unknown as GigKpi;
  assert.equal(nicheCell(n, unknownCost).costPerAcceptedUsd, null, "an unreported cost is not averaged in as free");
});

test("nicheTally and programTally sum attempt records; unreported cost stays a count", () => {
  const tallies = {
    a: { attempts: 3, byStatus: { failed: 1, drafted: 2 }, costUsd: 1.5, costUnreported: 1 },
    b: { attempts: 1, byStatus: { failed: 1 }, costUsd: 0, costUnreported: 1 },
  };
  assert.deepEqual(nicheTally({ hires: [spec("a", "x", "active"), spec("b", "x", "failed")] }, tallies), { attempts: 4, byStatus: { failed: 2, drafted: 2 }, costUsd: 1.5, costUnreported: 2 });
  assert.equal(programTally(tallies).attempts, 4);
  assert.equal(programTally(null).attempts, 0);
});

test("fileRows: filters compose; reward sorts within one currency and never across; absences sort last both ways", () => {
  const gigs = [
    gig("inr-small", "qualified", { reward: { amount: 100, currency: "INR", text: "₹100" } }),
    gig("usd", "qualified", { reward: { amount: 50, currency: "USD", text: "$50" } }),
    gig("inr-big", "qualified", { reward: { amount: 9000, currency: "INR", text: "₹9000" } }),
    gig("none", "qualified"),
    gig("sec", "suspect", { arena: "security" }),
  ];
  const map = new Map<string, string>();
  const base = { ...EMPTY_FILE, status: "qualified" as const, sort: "reward" as const };
  assert.deepEqual(fileRows(gigs, {}, base, map, NOW).map((g) => g.id), ["inr-big", "inr-small", "usd", "none"]);
  assert.deepEqual(fileRows(gigs, {}, { ...base, dir: -1 }, map, NOW).map((g) => g.id), ["inr-small", "inr-big", "usd", "none"]);
  assert.deepEqual(fileRows(gigs, {}, { ...EMPTY_FILE, arena: "security" }, map, NOW).map((g) => g.id), ["sec"]);
  assert.deepEqual(fileRows(gigs, {}, { ...EMPTY_FILE, search: "INR-BIG" }, map, NOW).map((g) => g.id), ["inr-big"]);
  assert.deepEqual(fileRows(gigs, {}, { ...EMPTY_FILE, lane: NO_LANE, status: "suspect" }, map, NOW).map((g) => g.id), ["sec"]);
});

test("fileRows by deadline: soonest open first, then the closed, then none; fit: unscored last", () => {
  const gigs = [
    gig("none", "new"),
    gig("closed", "new", { deadlineAt: inDays(-3) }),
    gig("d9", "new", { deadlineAt: inDays(9) }),
    gig("d1", "new", { deadlineAt: inDays(1) }),
  ];
  assert.deepEqual(fileRows(gigs, {}, { ...EMPTY_FILE, sort: "deadline" }, new Map(), NOW).map((g) => g.id), ["d1", "d9", "closed", "none"]);
  const fit = [gig("u", "new"), gig("lo", "new", { qualification: { score: 20 } as Gig["qualification"] }), gig("hi", "new", { qualification: { score: 80 } as Gig["qualification"] })];
  assert.deepEqual(fileRows(fit, {}, { ...EMPTY_FILE, sort: "fit" }, new Map(), NOW).map((g) => g.id), ["hi", "lo", "u"]);
});

const NOTE =
  "[Pre-send review by a reviewer agent for the operator - training cycle 2026-09-26] WARNINGS - operator decides. Before sending: 1) escape the line breaks in Q21. 2) Drop 'prevents repeats' or fix the refill logic. Checks run: node check.mjs -> OK | opened both PNGs Defects: BLOCKER: the shipped demo.html does not run | draftText claims 'served-question tracking prevents repeats'; 8 of 12 sessions repeated";

test("parseReviewNote reads header, lead, must-dos, checks and defects; nothing is dropped", () => {
  const n = parseReviewNote(NOTE)!;
  assert.equal(n.byAgent, true);
  assert.equal(n.cycle, "2026-09-26");
  assert.equal(n.verdict, "blocker");
  assert.equal(n.blockers, 1);
  assert.deepEqual(n.items, ["escape the line breaks in Q21.", "Drop 'prevents repeats' or fix the refill logic."]);
  assert.deepEqual(n.checks, ["node check.mjs -> OK", "opened both PNGs"]);
  assert.deepEqual(n.defects.map((d) => d.blocker), [true, false]);
  assert.match(n.lead, /^WARNINGS - operator decides\. Before sending:$/);
  const own = parseReviewNote("Looks fine, send it.")!;
  assert.equal(own.header, null);
  assert.equal(own.verdict, "note");
  assert.equal(parseReviewNote("  "), null);
});

test("quotedPhrases finds quoted phrases with a letter in them", () => {
  assert.deepEqual(quotedPhrases("Drop 'prevents repeats' or \"3x2\" and 'x'"), ["prevents repeats", "3x2"]);
});

test("draftParagraphs keeps each paragraph's first line and line count", () => {
  const p = draftParagraphs("Hi,\n\nFirst line\nsecond line\n\n\nLast");
  assert.deepEqual(p, [
    { text: "Hi,", firstLine: 1, lines: 1 },
    { text: "First line\nsecond line", firstLine: 3, lines: 2 },
    { text: "Last", firstLine: 7, lines: 1 },
  ]);
});

test("pinNotes: a lint excerpt lands on its line's paragraph; a quoting reviewer note pins; the rest are loose, never dropped", () => {
  const text = "Hello there.\n\nThe tracker prevents repeats.\nIt costs $500 for the build.";
  const paras = draftParagraphs(text);
  const lint: DraftLintFinding[] = [
    { id: "line:4:reward", severity: "warn", line: 4, messageKey: "rewardMentioned", params: { excerpt: "$500" } },
    { id: "cost:unreported", severity: "info", line: null, messageKey: "costUnreported", params: {} },
  ];
  const { pinned, loose } = pinNotes(paras, lint, parseReviewNote(NOTE));
  assert.deepEqual(pinned.map((n) => [n.key, n.para, n.source, paras[n.para].text.slice(n.start, n.end).toLowerCase()]), [
    ["a", 1, "review", "prevents repeats"],
    ["b", 1, "lint", "$500"],
  ]);
  // The blocker quotes nothing; the second defect quotes a longer phrase this draft does
  // not contain; must-do 1 quotes nothing. All three are listed, none lost.
  assert.deepEqual(loose.map((l) => l.role), ["defect", "defect", "must-do 1"], "a note that quotes nothing in the draft is listed, not lost");
});

test("paragraphSpans cuts plain and marked runs; overlapping notes share a run", () => {
  const text = "The tracker prevents repeats.";
  const n = (key: string, start: number, end: number) => ({ key, para: 0, start, end, source: "review" as const, blocker: false, finding: null, text: "x", role: "defect" });
  const spans = paragraphSpans(text, [n("a", 12, 28), n("b", 21, 28)]);
  assert.deepEqual(spans.map((s) => [s.text, s.mark?.map((m) => m.key) ?? null]), [
    ["The tracker ", null],
    ["prevents ", ["a"]],
    ["repeats", ["a", "b"]],
    [".", null],
  ]);
});

test("letterKey never repeats: a..z then aa", () => {
  assert.deepEqual([0, 1, 25, 26, 27].map(letterKey), ["a", "b", "z", "aa", "ab"]);
});

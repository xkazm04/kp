// The roles board (level 1 of the kit pipeline) and the way into level 2: the aggregation
// (role x stage counts, capped beads, waiting, "+N", the All-roles row, the sort), the `?role=`
// resolution, and the deep links that land on level 2. The wiring half is pinned by reading the
// view files, the way pipelineKitParity.test.ts pins the other capabilities.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Entry, StageDef } from "../../../shared/pipelineTypes.ts";
import { rankByMatch, type Ctx } from "./pipelineKitModel.ts";
import { ALL, atReadCap, BEAD_CAP, BOARD_READ_CAP, initialScope, resolveRole, roleParam, roleRows } from "./rolesBoardModel.ts";

const AXIS: StageDef[] = [
  { id: "Accepted", label: "Accepted", role: "entry" },
  { id: "Screened", label: "Screened", role: "screening" },
  { id: "Interview", label: "Interview", role: "interview" },
  { id: "Offer", label: "Offer", role: "offer" },
  { id: "Hired", label: "Hired", role: "terminal" },
];
let seq = 0;
function entry(job: string | null, title: string, stage: string, over: Partial<Entry> = {}): Entry {
  seq += 1;
  return {
    id: `e${seq}`, candidateId: null, candidateLabel: `C${seq}`, archetype: null, roleFamily: "Engineering", jobId: job, jobTitle: title, stage,
    matchScore: null, status: "active", approvalKind: null, approvalDetail: null,
    createdAt: "2026-09-01T00:00:00Z", stageChangedAt: "2026-09-01T00:00:00Z", ...over,
  };
}
const ctx: Ctx = { score: (e) => e.matchScore, needs: (e) => e.status === "active" && e.approvalKind != null, now: Date.parse("2026-09-25T12:00:00Z") };
const board = (es: Entry[], ai?: (e: Entry) => boolean) => roleRows(es, AXIS, { needs: ctx.needs, ai }, rankByMatch(es, ctx).rankOf);

test("one row per role (keyed by job id), a cell per axis stage, All roles first with the same columns summed", () => {
  const es = [
    entry("j1", "Backend", "Accepted"), entry("j1", "Backend", "Accepted"), entry("j1", "Backend", "Offer"),
    entry("j2", "Backend", "Screened"),
    entry(null, "Designer", "Hired"),
  ];
  const rows = board(es);
  assert.equal(rows[0].id, ALL);
  assert.equal(rows[0].all, true);
  assert.deepEqual(rows.slice(1).map((r) => r.id).sort(), ["Designer", "j1", "j2"], "two jobs sharing a title are two rows; no job id falls back to the title");
  assert.deepEqual(rows[0].cells.map((c) => c.count), [2, 1, 0, 1, 1]);
  const j1 = rows.find((r) => r.id === "j1")!;
  assert.deepEqual(j1.cells.map((c) => [c.stage, c.count]), [["Accepted", 2], ["Screened", 0], ["Interview", 0], ["Offer", 1], ["Hired", 0]]);
  assert.equal(j1.total, 3);
  assert.equal(j1.title, "Backend");
  assert.equal(j1.family, "Engineering");
});

test("a cell caps its beads at five, the waiting ones first, and says +N for the rest", () => {
  const es = Array.from({ length: 9 }, (_, i) => entry("j1", "Backend", "Screened", { matchScore: 90 - i, approvalKind: i >= 7 ? "screening_review" : null }));
  const cell = board(es)[1].cells[1];
  assert.equal(BEAD_CAP, 5);
  assert.equal(cell.count, 9);
  assert.equal(cell.waiting, 2);
  assert.equal(cell.beads.length, 5);
  assert.equal(cell.more, 4);
  assert.deepEqual(cell.beads.slice(0, 2).map((b) => b.needs), [true, true], "who waits on you is never hidden behind the cap");
  assert.deepEqual(cell.beads.slice(2).map((b) => b.id), [es[0].id, es[1].id, es[2].id], "then by match rank");
  assert.equal(cell.beads[0].tone, "screened", "the bead takes its stage's tone");
});

test("bead shapes are provenance: a recorded move is walked, an unmoved add is placed", () => {
  const es = [entry("j1", "Backend", "Offer", { stageChangedAt: "2026-09-10T00:00:00Z" }), entry("j1", "Backend", "Offer")];
  assert.deepEqual(board(es)[1].cells[3].beads.map((b) => b.shape).sort(), ["ring", "solid"]);
});

test("rows sort waiting-on-you first, then the latest move, then by title; totals, waiting, AI and the last move add up", () => {
  const es = [
    entry("a", "Alpha", "Accepted", { stageChangedAt: "2026-09-20T00:00:00Z" }),
    entry("b", "Bravo", "Screened", { approvalKind: "screening_review" }),
    entry("c", "Charlie", "Interview", { stageChangedAt: "2026-09-24T00:00:00Z" }),
    entry("d", "Delta", "Retired column"),
  ];
  const rows = board(es, (e) => e.stage === "Interview");
  assert.deepEqual(rows.map((r) => r.id), [ALL, "b", "c", "a", "d"]);
  assert.deepEqual([rows[0].total, rows[0].waiting, rows[0].ai, rows[0].lastMove], [4, 1, 1, "2026-09-24T00:00:00Z"]);
  const d = rows.find((r) => r.id === "d")!;
  assert.equal(d.total, 1, "an off-axis candidate counts in the role's total");
  assert.equal(d.cells.reduce((n, c) => n + c.count, 0), 0, "and in no cell: the Off-the-board section names them");
});

test("at scale: 40 roles and 3000 candidates aggregate into 41 rows with every candidate counted once", () => {
  const es: Entry[] = [];
  for (let i = 0; i < 3000; i++) es.push(entry(`job-${i % 40}`, `Role ${i % 40}`, AXIS[i % 5].id, { approvalKind: i % 17 === 0 ? "decision" : null }));
  const t0 = performance.now();
  const rows = board(es);
  const ms = performance.now() - t0;
  assert.equal(rows.length, 41);
  assert.equal(rows[0].total, 3000);
  assert.equal(rows.slice(1).reduce((n, r) => n + r.total, 0), 3000);
  assert.ok(rows.every((r) => r.cells.every((c) => c.beads.length <= BEAD_CAP && c.beads.length + c.more === c.count)));
  assert.ok(ms < 250, `the aggregation stays interactive (${ms.toFixed(1)} ms)`);
});

test("?role= resolves a lane key, a role title, or all; an unknown value stays as asked (an empty scope, never a wrong one)", () => {
  const es = [entry("j1", "Backend", "Accepted"), entry(null, "Designer", "Accepted")];
  assert.equal(resolveRole(null, es), null);
  assert.equal(resolveRole("j1", es), "j1");
  assert.equal(resolveRole("Backend", es), "j1", "a title deep link finds its role");
  assert.equal(resolveRole("Designer", es), "Designer");
  assert.equal(resolveRole("all", es), ALL);
  assert.equal(resolveRole("gone", es), "gone");
  assert.equal(roleParam(ALL), "all");
  assert.equal(roleParam("j1"), "j1");
});

test("deep links route to the right level: ?role= opens it, a link naming candidates opens every role, ?sort= alone stays on the board", () => {
  const url = (q: string) => (k: string) => new URLSearchParams(q).get(k);
  assert.equal(initialScope(url("tab=pipeline")), null, "the tab's default is the roles board");
  assert.equal(initialScope(url("role=j1")), "j1");
  assert.equal(initialScope(url("role=all")), ALL);
  assert.equal(initialScope(url("role=j1&stage=Offer")), "j1", "?role= wins; ?stage= still filters inside it");
  for (const q of ["q=Ana", "stage=Interview", "quick=aging", "score=strong", "source=careers"]) assert.equal(initialScope(url(q)), ALL, q);
  assert.equal(initialScope(url("sort=score")), null);
  assert.equal(initialScope(url("q=%20%20")), null, "a blank search names nobody");
});

test("the read cap is the server's, and a board at it says so", () => {
  const src = readFileSync(new URL("../../../../_lib/db/pipeline.ts", import.meta.url), "utf8");
  assert.match(src, new RegExp(`export const PIPELINE_BOARD_CAP = ${BOARD_READ_CAP};`));
  assert.equal(atReadCap(BOARD_READ_CAP - 1), false);
  assert.equal(atReadCap(BOARD_READ_CAP), true);
  assert.match(readFileSync(new URL("./PipelineKitRoles.tsx", import.meta.url), "utf8"), /atReadCap\(k\.entries\.length\) \? <Note tone="caution">/);
});

test("wiring: the board, then the scope under it; the scope carries the Sieve (bars at scale), Skyline and list; ?role= is tab-scoped", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const view = read("./PipelineKitView.tsx");
  assert.ok(view.indexOf("<PipelineKitRoles") > 0 && view.indexOf("<PipelineKitScope") > view.indexOf("<PipelineKitRoles"));
  const scope = read("./PipelineKitScope.tsx");
  for (const part of ["<PipelineKitRole ", "<PipelineKitSieve ", "<PipelineKitSkyline ", "<PipelineKitList "]) assert.ok(scope.includes(part), part);
  assert.match(read("./PipelineKitSieve.tsx"), /barsAbove=\{SIEVE_BARS_ABOVE\}/);
  assert.match(read("./useKitFilters.ts"), /initialScope\(\(k\) => search\.get\(k\)\)/);
  assert.match(read("./useKitFilters.ts"), /buildUrl\(\{ role: roleParam\(next\) \}/);
  assert.match(read("./usePipelineKit.ts"), /entryLaneKey\(e\) === lane/, "level 2 reads its scope alone");
  assert.match(read("../../../shell/tabs.ts"), /\n {2}"role",\n/);
});

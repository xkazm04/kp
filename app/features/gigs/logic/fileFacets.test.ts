// The whole file's faceted dropdowns (fileFacets.ts) and the negative default (file.ts):
// each dimension counts over the gigs the OTHER filters and the search let through.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Gig } from "@/app/_lib/gigs/types.ts";
import { EMPTY_FILE, fileRows, fileStateOf, type FileFilter } from "./file.ts";
import { type FacetOption, fileFacets, hiddenByStatus } from "./fileFacets.ts";
import { gig, inDays, NOW } from "./fixtures.ts";

const pairs = <V>(opts: FacetOption<V>[]) => opts.map((o) => [o.value, o.count, o.off] as const);
const ids = (gigs: readonly Gig[], f: FileFilter) => fileRows(gigs, f, NOW).map((g) => g.id);

const FILE: Gig[] = [
  gig("q1", "qualified"),
  gig("q2", "qualified", { arena: "security" }),
  gig("late", "qualified", { deadlineAt: inDays(-1) }),
  gig("sentLate", "sent", { deadlineAt: inDays(-1) }),
  gig("dec1", "declined"),
  gig("dec2", "declined", { arena: "security" }),
  gig("wd", "withdrawn"),
  gig("exp", "expired"),
  gig("rej", "rejected", { arena: "competition" }),
  gig("acc", "accepted", { arena: "competition" }),
  gig("sus", "suspect", { arena: "security" }),
];

test("the default hides every negative state (declined, withdrawn, expired, rejected, overdue) and keeps suspect", () => {
  assert.equal(EMPTY_FILE.status, "active");
  assert.deepEqual(ids(FILE, EMPTY_FILE), ["q1", "q2", "sentLate", "acc", "sus"]);
  assert.equal(fileStateOf(FILE[2], NOW), "overdue", "unsent past its deadline");
  assert.equal(fileStateOf(FILE[3], NOW), "sent", "a sent gig keeps its row whatever its deadline says");
  const f = fileFacets(FILE, EMPTY_FILE, NOW);
  assert.equal(hiddenByStatus(f), 6);
  // Picking a negative state is how the operator sees it.
  assert.deepEqual(ids(FILE, { ...EMPTY_FILE, status: "declined" }), ["dec1", "dec2"]);
  assert.deepEqual(ids(FILE, { ...EMPTY_FILE, status: "overdue" }), ["late"]);
  assert.equal(ids(FILE, { ...EMPTY_FILE, status: "all" }).length, FILE.length);
});

test("status options: All and Active lead, the states follow by count, ties in the order of the line", () => {
  const f = fileFacets(FILE, EMPTY_FILE, NOW);
  assert.deepEqual(pairs(f.status), [
    ["all", 11, false],
    ["active", 5, false],
    ["qualified", 2, false],
    ["declined", 2, false],
    ["suspect", 1, false],
    ["sent", 1, false],
    ["accepted", 1, false],
    ["rejected", 1, false],
    ["expired", 1, false],
    ["withdrawn", 1, false],
    ["overdue", 1, false],
  ]);
  const total = f.status.slice(2).reduce((n, o) => n + o.count, 0);
  assert.equal(total, 11, "every gig has exactly one state: the states add up to All");
});

test("faceted: an arena recounts the status options, a status recounts the arenas; zero is off and last unless picked", () => {
  const sec = fileFacets(FILE, { ...EMPTY_FILE, arena: "security" }, NOW);
  assert.deepEqual(pairs(sec.status).slice(0, 5), [
    ["all", 3, false],
    ["active", 2, false],
    ["suspect", 1, false],
    ["qualified", 1, false],
    ["declined", 1, false],
  ]);
  assert.ok(sec.status.slice(5).every((o) => o.count === 0 && o.off), "the rest hold nothing in security: off, at the end");
  // The arena counts under "active" leave the negative states out.
  assert.deepEqual(pairs(sec.arena), [
    ["all", 5, false],
    ["security", 2, false],
    ["freelance", 2, false],
    ["competition", 1, false],
    ["oss_bounty", 0, true],
  ]);
  // A picked value that holds nothing under the combination stays listed and enabled.
  const picked = fileFacets(FILE, { ...EMPTY_FILE, arena: "oss_bounty", status: "withdrawn" }, NOW);
  assert.deepEqual(picked.arena.find((o) => o.value === "oss_bounty"), { value: "oss_bounty", count: 0, off: false });
  assert.deepEqual(picked.status.find((o) => o.value === "withdrawn"), { value: "withdrawn", count: 0, off: false });
  assert.deepEqual(pairs(picked.arena).slice(0, 2), [["all", 1, false], ["freelance", 1, false]]);
});

test("the lane dropdown lists the types the file holds; a status recounts it", () => {
  const f = fileFacets(FILE, { ...EMPTY_FILE, status: "all" }, NOW);
  // Arena fallback: security -> security, competition -> data-ml, freelance -> other.
  assert.deepEqual(pairs(f.lane), [[null, 11, false], ["other", 6, false], ["security", 3, false], ["data-ml", 2, false]]);
  const dec = fileFacets(FILE, { ...EMPTY_FILE, status: "declined" }, NOW);
  assert.deepEqual(pairs(dec.lane), [[null, 2, false], ["security", 1, false], ["other", 1, false], ["data-ml", 0, true]]);
  const onLane = fileFacets(FILE, { ...EMPTY_FILE, lane: "security" }, NOW);
  assert.deepEqual(pairs(onLane.status).slice(0, 2), [["all", 3, false], ["active", 2, false]]);
});

test("search narrows every dropdown, and a lane opened from Lanes stays listed with its group status", () => {
  const f = fileFacets(FILE, { ...EMPTY_FILE, search: "DEC" }, NOW);
  assert.deepEqual(pairs(f.status).slice(0, 3), [["all", 2, false], ["active", 0, false], ["declined", 2, false]]);
  assert.equal(hiddenByStatus(f), 2, "the count line names the two the default hides");
  assert.deepEqual(pairs(f.arena).slice(0, 1), [["all", 0, false]], "under Active the search finds nothing");
  const exit = fileFacets(FILE, { ...EMPTY_FILE, status: "exit", lane: "web" }, NOW);
  assert.deepEqual(exit.status.at(-1), { value: "exit", count: 0, off: false });
  assert.deepEqual(exit.lane.find((o) => o.value === "web"), { value: "web", count: 0, off: false });
  assert.deepEqual(fileFacets(FILE, { ...EMPTY_FILE, status: "exit" }, NOW).status.find((o) => o.value === "exit"), { value: "exit", count: 4, off: false });
});

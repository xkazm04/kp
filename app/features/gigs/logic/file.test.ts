// Pure logic for the whole file (file.ts): filters compose, and each sort puts absences last.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Gig } from "@/app/_lib/gigs/types.ts";
import { EMPTY_FILE, fileRows } from "./file.ts";
import { gig, inDays, NOW } from "./fixtures.ts";
import { NO_LANE } from "./niches.ts";

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

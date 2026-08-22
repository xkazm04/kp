// Pins the saved-profile roster's filter/sort rules. The old roster had none of
// this — it rendered every profile in fetch order — so these are the guarantees the
// new ledger table adds, tested on the pure view model rather than through a render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rosterFacets, rosterRows, rosterStatus } from "./profileRosterView.ts";
import type { RosterProfile, StaleMap } from "./ProfileRosterTypes.ts";

const P = (id: string, label: string, archetype: string | null, family: string | null, c: number | null): RosterProfile => ({
  id,
  label,
  archetype,
  role_family: family,
  completeness: c,
});

// `bau` and `student` are real registry archetypes; "made-up" is not, so it must
// display (and filter) as the honest "unrouted" bucket — see archetypeDisplayKey.
const PROFILES: RosterProfile[] = [
  P("1", "Zoe Adams", "bau", "engineering", 0.9),
  P("2", "Adam Zeman", "student", "engineering", 0.4),
  P("3", "Čapek Karel", "bau", "design", null),
  P("4", "Mia Novak", "made-up", null, 0.6),
];
const STALE: StaleMap = { "2": { newerSlug: "cv-2", newerAnalyzedAt: "2026-01-01T00:00:00Z" } };
const ARCHIVED = new Set(["student"]);
const enumLabel = (group: string, slug: string | null | undefined) => `${group}:${slug ?? ""}`;
const statusLabel = (s: string) => `st:${s}`;
const base = { stale: STALE, archivedSet: ARCHIVED, locale: "en", enumLabel };
const sortByName = { col: "name", dir: "asc" } as const;

test("retired outranks stale — a profile can only carry one status", () => {
  // Profile 2 is BOTH stale and routed to a retired archetype.
  assert.equal(rosterStatus(PROFILES[1], STALE, ARCHIVED), "retired");
  assert.equal(rosterStatus(PROFILES[0], STALE, ARCHIVED), "current");
  assert.equal(rosterStatus(PROFILES[1], STALE, new Set()), "stale");
});

test("facets offer only values actually present, so no filter can yield zero rows", () => {
  const f = rosterFacets(PROFILES, { locale: "en", enumLabel, stale: STALE, archivedSet: ARCHIVED, statusLabel });
  assert.deepEqual(
    f.archetypes.map((o) => o.value).sort(),
    ["bau", "student", "unrouted"],
    "an unknown archetype folds into the unrouted bucket rather than leaking a raw id"
  );
  assert.deepEqual(f.families.map((o) => o.value).sort(), ["design", "engineering"]);
  // `stale` is absent: profile 2 is retired, and nothing else has a newer CV.
  assert.deepEqual(f.statuses.map((o) => o.value), ["retired", "current"], "status keeps severity order, worst first");
});

test("every filter narrows, and they compose", () => {
  const run = (filters: Partial<Parameters<typeof rosterRows>[1]["filters"]>) =>
    rosterRows(PROFILES, { ...base, sort: sortByName, filters: { q: "", archetype: "", family: "", status: "", ...filters } }).map(
      (p) => p.id
    );
  assert.deepEqual(run({}).length, 4);
  // "ada" hits "Adam Zeman" and "Zoe Adams" — a substring match anywhere in the
  // name, case-insensitive, returned in the active sort order (name, ascending).
  assert.deepEqual(run({ q: "ada" }), ["2", "1"], "name search is case-insensitive and substring");
  assert.deepEqual(run({ archetype: "bau" }).sort(), ["1", "3"]);
  assert.deepEqual(run({ archetype: "unrouted" }), ["4"]);
  assert.deepEqual(run({ family: "design" }), ["3"]);
  assert.deepEqual(run({ status: "retired" }), ["2"]);
  assert.deepEqual(run({ archetype: "bau", family: "engineering" }), ["1"], "filters compose (AND)");
  assert.deepEqual(run({ archetype: "bau", family: "design", q: "zoe" }), [], "a contradictory combination is empty, not everything");
});

test("name search is diacritic-insensitive — 'capek' must find Čapek", () => {
  const run = (q: string) =>
    rosterRows(PROFILES, { ...base, sort: sortByName, filters: { q, archetype: "", family: "", status: "" } }).map((p) => p.id);
  // A Czech recruiter on a foreign keyboard cannot type Č. A diacritic-EXACT filter
  // answers "No profile matches these filters" and a "0 of 4" count — i.e. the
  // candidate is invisible and reads as never saved. Same fold as the analytics
  // audit log's subject search (UAT LUC-ANA-5).
  assert.deepEqual(run("capek"), ["3"], "ASCII query finds the diacritic name");
  assert.deepEqual(run("CAPEK"), ["3"], "and is case-insensitive on top of that");
  // The reverse direction too: typing the diacritic must still find it.
  assert.deepEqual(run("Čapek"), ["3"]);
  // Folding widens the match; it must not make the filter match everything.
  assert.deepEqual(run("novak"), ["4"]);
  assert.deepEqual(run("zzz"), []);
});

test("completeness sorts numerically and puts unknown at the least-complete end", () => {
  const ids = (dir: "asc" | "desc") =>
    rosterRows(PROFILES, { ...base, filters: { q: "", archetype: "", family: "", status: "" }, sort: { col: "completeness", dir } }).map(
      (p) => p.id
    );
  // Profile 3 has a null completeness: it is not 0%, but it is the row needing work.
  assert.deepEqual(ids("asc"), ["3", "2", "4", "1"]);
  assert.deepEqual(ids("desc"), ["1", "4", "2", "3"]);
});

test("name sort is locale-collated, not UTF-16 — Č must not land after Z", () => {
  const ids = rosterRows(PROFILES, {
    ...base,
    locale: "cs",
    filters: { q: "", archetype: "", family: "", status: "" },
    sort: sortByName,
  }).map((p) => p.label);
  assert.equal(ids[0], "Adam Zeman");
  assert.equal(ids[1], "Čapek Karel", "Č sorts right after A/C in cs, not after Z");
  assert.equal(ids[3], "Zoe Adams");
});

test("a coarse sort column falls back to name, so equal rows never shuffle", () => {
  const ids = rosterRows(PROFILES, {
    ...base,
    filters: { q: "", archetype: "", family: "", status: "" },
    sort: { col: "archetype", dir: "asc" },
  }).map((p) => p.id);
  // Both `bau` rows compare equal on the sort column; name breaks the tie
  // deterministically ("Zoe Adams" after "Čapek Karel" under the en collator).
  assert.deepEqual(ids.slice(0, 2), ["3", "1"]);
});

test("rosterRows never mutates the input array", () => {
  const order = PROFILES.map((p) => p.id);
  rosterRows(PROFILES, { ...base, filters: { q: "", archetype: "", family: "", status: "" }, sort: { col: "completeness", dir: "desc" } });
  assert.deepEqual(PROFILES.map((p) => p.id), order);
});

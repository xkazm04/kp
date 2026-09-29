// Pure logic for Lanes (lanes.ts): one row per gig type, the lifecycle counts per type,
// "none here now" vs "never reached", and each type's gig personas.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GIG_TYPES } from "@/app/_lib/gigs/gig-type.ts";
import type { GigBrief } from "@/app/_lib/gigs/types.ts";
import { gig, spec } from "./fixtures.ts";
import { laneRows, personasByType } from "./lanes.ts";

const brief = (category: string) => ({ category }) as GigBrief;

test("laneRows: one row per gig type in the vocabulary's order; a gig lands by its brief category, else its arena", () => {
  const gigs = [
    gig("a", "drafted", { brief: brief("Web security · Stored XSS") }),
    gig("b", "accepted", { brief: brief("Web security") }),
    gig("c", "declined", { arena: "security" }),
    gig("d", "new", { brief: brief("Frontend · React") }),
    gig("e", "new"),
  ];
  const rows = laneRows(gigs, {});
  assert.deepEqual(rows.map((r) => r.key), [...GIG_TYPES], "every type, always, so the table keeps its shape");
  const row = (k: string) => rows.find((r) => r.key === k)!;
  const at = (k: string, step: string) => row(k).cells.find((c) => c.step === step)!;
  assert.equal(row("security").total, 3);
  assert.equal(at("security", "drafted").count, 1);
  assert.equal(at("security", "verdict").count, 1, "the two verdicts share one column");
  assert.equal(row("security").exit, 1, "a way off the line is counted apart");
  assert.equal(at("security", "qualified").count, 0);
  assert.equal(at("security", "qualified").reached, true, "a drafted gig passed qualified: none here NOW");
  assert.equal(at("security", "suspect").reached, false, "nothing of this type was ever quarantined");
  assert.equal(at("web", "new").count, 1);
  assert.equal(at("other", "new").count, 1, "a freelance gig with no brief falls back to other");
  assert.equal(row("ui").total, 0);
  assert.equal(at("ui", "new").reached, false);
});

test("personasByType: a gig persona files under its gig's type; niche specialists belong to no lane", () => {
  const gigs = [gig("g1", "dispatched", { arena: "security" }), gig("g2", "drafted", { brief: brief("UI design") })];
  const own = (id: string, gigId: string) => ({ ...spec(id, "x", "active"), gigId });
  const byType = personasByType(gigs, [own("p1", "g1"), own("p2", "g2"), own("p3", "gone"), spec("niche", "web", "active")]);
  assert.deepEqual(byType.security.map((s) => s.id), ["p1"]);
  assert.deepEqual(byType.ui.map((s) => s.id), ["p2"]);
  assert.equal(Object.values(byType).flat().length, 2, "a persona whose gig is not in the list, and a niche specialist, are in no lane");
});
